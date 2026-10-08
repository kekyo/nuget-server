// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { open, readFile } from 'fs/promises';
import { createReaderWriterLock } from 'async-primitives';
import { Secret, TOTP } from 'otpauth';
import { TotpCredentials, User, UserService } from './userService';

const pendingLifetime = 5 * 60_000;
const failureLifetime = 10 * 60_000;
const maximumEntries = 4096;

interface PendingAuthentication {
  username: string;
  userId: string;
  authVersion: number;
  expiresAt: number;
  attempts: number;
  rememberMe: boolean;
}

interface PendingEnrollment extends PendingAuthentication {
  secret: string;
}

/** Dependencies for optional TOTP enrollment and authentication. */
export interface TotpServiceConfig {
  /** Account store; second-factor consumption is serialized with other updates. */
  users: UserService;
  /** Persistent encryption key file, independent of session keys. */
  keyFile: string;
  /** Human-readable registry name used by authenticator applications. */
  issuer: string;
}

const fail = (code: string, statusCode: number): never => {
  throw Object.assign(new Error(code), { code, statusCode });
};

/**
 * Creates a second-factor service with short-lived, server-side challenges.
 * @param config Account store, encryption key location and issuer.
 * @returns Service for registration and two-step login.
 * @remarks One writable server process must own a given account store.
 */
export const createTotpService = (config: TotpServiceConfig) => {
  const challenges = new Map<string, PendingAuthentication>();
  const enrollments = new Map<string, PendingEnrollment>();
  const failures = new Map<string, { count: number; expiresAt: number }>();
  const lock = createReaderWriterLock();
  let encryptionKey: Buffer | undefined;

  const locked = async <T>(action: () => Promise<T>): Promise<T> => {
    const handle = await lock.writeLock();
    try {
      return await action();
    } finally {
      handle.release();
    }
  };

  const prune = (): void => {
    const now = Date.now();
    for (const entries of [challenges, enrollments, failures]) {
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(key);
      }
    }
  };

  const checkAttempts = (userId: string, ip: string): void => {
    prune();
    if (
      (failures.get(`user:${userId}`)?.count ?? 0) >= 10 ||
      (failures.get(`ip:${ip}`)?.count ?? 0) >= 50
    )
      fail('TOTP_RATE_LIMITED', 429);
    if (failures.size >= maximumEntries) fail('TOTP_RATE_LIMITED', 429);
  };

  const attempt = async <T>(
    userId: string,
    ip: string,
    action: () => Promise<T>
  ): Promise<T> => {
    checkAttempts(userId, ip);
    try {
      return await action();
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 400) {
        for (const key of [`user:${userId}`, `ip:${ip}`]) {
          const entry = failures.get(key) ?? {
            count: 0,
            expiresAt: Date.now() + failureLifetime,
          };
          entry.count++;
          failures.set(key, entry);
        }
      }
      throw error;
    }
  };

  const key = async (allowCreate: boolean): Promise<Buffer> => {
    if (encryptionKey) return encryptionKey;
    try {
      encryptionKey = await readFile(config.keyFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !allowCreate)
        throw error;
      // Never replace a missing key while any account still needs it.
      if ((await config.users.getAllUsers()).some((user) => user.totp)) {
        throw new Error(
          'TOTP encryption key is missing. Restore the key from backup.'
        );
      }
      const generated = randomBytes(32);
      const file = await open(config.keyFile, 'wx', 0o600);
      try {
        await file.writeFile(generated);
        await file.sync();
      } finally {
        await file.close();
      }
      encryptionKey = generated;
    }
    if (encryptionKey.length !== 32)
      throw new Error('TOTP encryption key must contain exactly 32 bytes.');
    return encryptionKey;
  };

  const encrypt = async (secret: string, userId: string): Promise<string> => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await key(true), iv);
    cipher.setAAD(Buffer.from(userId));
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64'))
      .join('.');
  };

  const decrypt = async (secret: string, userId: string): Promise<string> => {
    const parts = secret.split('.');
    if (parts.length !== 3)
      throw new Error('Invalid TOTP encryption envelope.');
    const [iv, tag, ciphertext] = parts.map((part) =>
      Buffer.from(part, 'base64')
    );
    const cipher = createDecipheriv('aes-256-gcm', await key(false), iv!);
    cipher.setAAD(Buffer.from(userId));
    cipher.setAuthTag(tag!);
    return Buffer.concat([cipher.update(ciphertext!), cipher.final()]).toString(
      'utf8'
    );
  };

  const authenticator = (secret: string, username: string) =>
    new TOTP({
      issuer: config.issuer,
      label: username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

  const matchingStep = (
    secret: string,
    code: string,
    lastUsedStep: number
  ): number => {
    if (!/^\d{6}$/.test(code)) return fail('TOTP_INVALID', 400);
    const now = Date.now();
    const delta = authenticator(secret, '').validate({
      token: code,
      timestamp: now,
      window: 1,
    });
    const step = Math.floor(now / 30_000) + (delta ?? 0);
    if (delta === null || step <= lastUsedStep)
      return fail('TOTP_INVALID', 400);
    return step;
  };

  const pending = (user: User, rememberMe: boolean): PendingAuthentication => ({
    username: user.username,
    userId: user.id,
    authVersion: user.authVersion ?? 0,
    expiresAt: Date.now() + pendingLifetime,
    attempts: 0,
    rememberMe,
  });

  const currentUser = async (state: PendingAuthentication): Promise<User> => {
    const user = await config.users.getUser(state.username);
    if (
      !user ||
      user.id !== state.userId ||
      (user.authVersion ?? 0) !== state.authVersion
    )
      return fail('TOTP_EXPIRED', 400);
    return user;
  };

  const recoveryHash = (code: string, userId: string): string =>
    createHash('sha256')
      .update(`${userId}:${code.replace(/-/g, '').toLowerCase()}`)
      .digest('hex');

  const newRecoveryCodes = (): string[] =>
    Array.from({ length: 10 }, () =>
      randomBytes(16).toString('hex').match(/.{4}/g)!.join('-')
    );

  const consumeFactor = (
    credentials: TotpCredentials,
    secret: string,
    userId: string,
    code: string,
    recovery: boolean
  ): TotpCredentials => {
    if (!recovery)
      return {
        ...credentials,
        lastUsedStep: matchingStep(secret, code, credentials.lastUsedStep),
      };
    if (!/^[a-f0-9]{32}$/i.test(code.replace(/-/g, '')))
      return fail('TOTP_INVALID', 400);
    const hash = Buffer.from(recoveryHash(code, userId), 'hex');
    const index = credentials.recoveryCodeHashes.findIndex((stored) => {
      const candidate = Buffer.from(stored, 'hex');
      return (
        candidate.length === hash.length && timingSafeEqual(candidate, hash)
      );
    });
    if (index < 0) return fail('TOTP_INVALID', 400);
    return {
      ...credentials,
      recoveryCodeHashes: credentials.recoveryCodeHashes.filter(
        (_, i) => i !== index
      ),
    };
  };

  const reauthenticate = async (
    user: User,
    password: string
  ): Promise<User> => {
    const verified = await config.users.validateCredentials(
      user.username,
      password
    );
    if (
      !verified ||
      verified.id !== user.id ||
      (verified.authVersion ?? 0) !== (user.authVersion ?? 0)
    )
      return fail('TOTP_PASSWORD_INVALID', 400);
    return verified;
  };

  return {
    /** Verifies that enrolled accounts can still be decrypted after a restart. */
    initialize: async (): Promise<void> => {
      for (const user of await config.users.getAllUsers()) {
        if (user.totp) await decrypt(user.totp.encryptedSecret, user.id);
      }
    },
    /** Clears pending authentication and releases the in-memory encryption key. */
    destroy: (): void => {
      challenges.clear();
      enrollments.clear();
      failures.clear();
      encryptionKey?.fill(0);
      encryptionKey = undefined;
    },
    /**
     * Issues a login challenge after password verification.
     * @param user Password-authenticated account snapshot.
     * @param rememberMe Whether the completed session should last seven days.
     * @param ip Trusted client IP for attempt limiting.
     * @returns Random challenge identifier, valid for five minutes.
     */
    beginLogin: (user: User, rememberMe: boolean, ip: string): string => {
      checkAttempts(user.id, ip);
      if (challenges.size >= maximumEntries)
        return fail('TOTP_RATE_LIMITED', 429);
      const token = randomBytes(32).toString('hex');
      challenges.set(token, pending(user, rememberMe));
      return token;
    },
    /**
     * Consumes a login challenge and one unused authenticator or recovery code.
     * @param token Challenge cookie value.
     * @param code Authenticator or recovery code.
     * @param ip Trusted client IP for attempt limiting.
     * @param recovery Whether to use a recovery code.
     * @returns Authenticated account and requested session lifetime.
     */
    verifyLogin: async (
      token: string,
      code: string,
      ip: string,
      recovery: boolean
    ) =>
      await locked(async () => {
        prune();
        const state = challenges.get(token);
        if (!state || state.attempts >= 5) return fail('TOTP_EXPIRED', 400);
        return await attempt(state.userId, ip, async () => {
          state.attempts++;
          const user = await currentUser(state);
          if (!user.totp) return fail('TOTP_EXPIRED', 400);
          const secret = await decrypt(user.totp.encryptedSecret, user.id);
          const updated = await config.users.mutateTotp(
            user.username,
            state.authVersion,
            (credentials) => {
              if (!credentials) return fail('TOTP_EXPIRED', 400);
              return consumeFactor(
                credentials,
                secret,
                user.id,
                code,
                recovery
              );
            },
            false
          );
          if (!updated) return fail('TOTP_EXPIRED', 400);
          challenges.delete(token);
          return { user: updated, rememberMe: state.rememberMe };
        });
      }),
    /**
     * Prepares a new authenticator after checking the current password.
     * @param user Session-authenticated account.
     * @param sessionToken Session owning the pending enrollment.
     * @param password Current UI password.
     * @param ip Trusted client IP for attempt limiting.
     * @param code Existing authenticator or recovery code, required for replacement.
     * @param recovery Whether code is a recovery code.
     * @returns Registration URI and manual entry key.
     */
    setup: async (
      user: User,
      sessionToken: string,
      password: string,
      ip: string,
      code: string,
      recovery: boolean
    ) =>
      await locked(async () => {
        return await attempt(user.id, ip, async () => {
          const verified = await reauthenticate(user, password);
          if (verified.totp) {
            const secret = await decrypt(
              verified.totp.encryptedSecret,
              verified.id
            );
            const consumed = await config.users.mutateTotp(
              verified.username,
              verified.authVersion ?? 0,
              (credentials) => {
                if (!credentials) return fail('TOTP_EXPIRED', 400);
                return consumeFactor(
                  credentials,
                  secret,
                  verified.id,
                  code,
                  recovery
                );
              },
              false
            );
            if (!consumed) return fail('TOTP_EXPIRED', 400);
          }
          if (enrollments.size >= maximumEntries)
            return fail('TOTP_RATE_LIMITED', 429);
          await key(true);
          const secret = new Secret({ size: 20 }).base32;
          enrollments.set(sessionToken, {
            ...pending(verified, false),
            secret,
          });
          return {
            secret,
            uri: authenticator(secret, verified.username).toString(),
          };
        });
      }),
    /**
     * Confirms enrollment and invalidates previously issued sessions.
     * @param sessionToken Session owning the registration.
     * @param code Code generated by the newly enrolled authenticator.
     * @param ip Trusted client IP for attempt limiting.
     * @returns Updated account and ten recovery codes, shown only once.
     */
    confirm: async (sessionToken: string, code: string, ip: string) =>
      await locked(async () => {
        prune();
        const state = enrollments.get(sessionToken);
        if (!state || state.attempts >= 5) return fail('TOTP_EXPIRED', 400);
        return await attempt(state.userId, ip, async () => {
          state.attempts++;
          await currentUser(state);
          const lastUsedStep = matchingStep(state.secret, code, -1);
          const encryptedSecret = await encrypt(state.secret, state.userId);
          const recoveryCodes = newRecoveryCodes();
          const credentials: TotpCredentials = {
            encryptedSecret,
            lastUsedStep,
            enabledAt: new Date().toISOString(),
            recoveryCodeHashes: recoveryCodes.map((value) =>
              recoveryHash(value, state.userId)
            ),
          };
          const user = await config.users.mutateTotp(
            state.username,
            state.authVersion,
            () => credentials,
            true
          );
          if (!user) return fail('TOTP_EXPIRED', 400);
          enrollments.delete(sessionToken);
          return { user, recoveryCodes };
        });
      }),
    /**
     * Disables TOTP or regenerates recovery codes after checking both factors.
     * @param user Session-authenticated account.
     * @param password Current UI password.
     * @param code Unused authenticator or recovery code.
     * @param recovery Whether to verify a recovery code.
     * @param action Requested credential change.
     * @param ip Trusted client IP for attempt limiting.
     * @returns Updated account and replacement recovery codes, if requested.
     */
    manage: async (
      user: User,
      password: string,
      code: string,
      recovery: boolean,
      action: 'disable' | 'recovery',
      ip: string
    ) =>
      await locked(async () => {
        return await attempt(user.id, ip, async () => {
          const verified = await reauthenticate(user, password);
          if (!verified.totp) return fail('TOTP_EXPIRED', 400);
          const secret = await decrypt(verified.totp.encryptedSecret, user.id);
          const recoveryCodes = action === 'recovery' ? newRecoveryCodes() : [];
          const updated = await config.users.mutateTotp(
            user.username,
            verified.authVersion ?? 0,
            (credentials) => {
              if (!credentials) return fail('TOTP_EXPIRED', 400);
              const consumed = consumeFactor(
                credentials,
                secret,
                user.id,
                code,
                recovery
              );
              return action === 'disable'
                ? undefined
                : {
                    ...consumed,
                    recoveryCodeHashes: recoveryCodes.map((value) =>
                      recoveryHash(value, user.id)
                    ),
                  };
            },
            true
          );
          if (!updated) return fail('TOTP_EXPIRED', 400);
          return { user: updated, recoveryCodes };
        });
      }),
    /**
     * Discards pending registration and/or login for the current browser.
     * @param sessionToken Session with a pending registration.
     * @param challengeToken Pending login challenge.
     */
    cancel: (sessionToken: string, challengeToken: string): void => {
      enrollments.delete(sessionToken);
      challenges.delete(challengeToken);
    },
  };
};

/** Service managing authenticator enrollment and login challenges. */
export type TotpService = ReturnType<typeof createTotpService>;
