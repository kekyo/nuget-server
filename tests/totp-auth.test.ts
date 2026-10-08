import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createReaderWriterLock } from 'async-primitives';
import { FastifyInstance } from 'fastify';
import { createFastifyInstance } from '../src/server';
import { createUserService } from '../src/services/userService';
import { createTestDirectory } from './helpers/test-helper';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const password = 'TotpTestPassword!123';
const timestamp = 1_800_000_000_000;

// Independently compute the authenticator output, including leading zeroes.
const codeAt = (secret: string, time: number): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, '0');
};

describe('Optional TOTP authentication', () => {
  let app: FastifyInstance;
  let directory: string;
  let cookie: string;

  beforeEach(async ({ task }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(timestamp);
    vi.stubEnv('NUGET_SERVER_AUTH_FAILURE_DELAY_ENABLED', 'false');
    directory = await createTestDirectory('totp-auth', task.name);
    await mkdir(join(directory, 'packages'), { recursive: true });
    const users = createUserService({
      configDir: directory,
      logger,
      serverConfig: { port: 5963, passwordStrengthCheck: false },
    });
    await users.initialize();
    await users.createUser({ username: 'alice', password, role: 'admin' });
    users.destroy();
    app = await createFastifyInstance(
      {
        port: 5963,
        configDir: directory,
        packageDir: join(directory, 'packages'),
        authMode: 'full',
        realm: 'Test registry',
        passwordStrengthCheck: false,
      },
      logger,
      createReaderWriterLock()
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password },
    });
    expect(response.statusCode).toBe(200);
    cookie = response.cookies.find((c) => c.name === 'sessionToken')!.value;
  });

  afterEach(async () => {
    if (app) await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('enrolls only after code confirmation, then requires a second factor', async () => {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'setup', password },
    });
    expect(setup.statusCode).toBe(200);
    expect(setup.headers['cache-control']).toBe('no-store');
    const { secret, uri } = setup.json();
    expect(new URL(uri).searchParams.get('secret')).toBe(secret);
    expect(new URL(uri).searchParams.get('issuer')).toBe('Test registry');
    const status = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'status' },
    });
    expect(status.json().enabled).toBe(false);
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'confirm', code: codeAt(secret, timestamp) },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().recoveryCodes).toHaveLength(10);
    const stored = await readFile(join(directory, 'users.json'), 'utf8');
    expect(stored).not.toContain(secret);
    for (const code of confirm.json().recoveryCodes)
      expect(stored).not.toContain(code);
    const oldSession = await app.inject({
      url: '/api/auth/session',
      cookies: { sessionToken: cookie },
    });
    expect(oldSession.json().authenticated).toBe(false);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password, rememberMe: true },
    });
    expect(login.json().totpRequired).toBe(true);
    expect(
      login.cookies.some((c) => c.name === 'sessionToken' && c.value)
    ).toBe(false);
    const challenge = login.cookies.find(
      (c) => c.name === 'totpChallenge'
    )!.value;
    const denied = await app.inject({
      method: 'POST',
      url: '/api/ui/users',
      cookies: { totpChallenge: challenge },
      payload: { action: 'list' },
    });
    expect(denied.statusCode).toBe(401);
    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/login/totp',
      cookies: { totpChallenge: challenge },
      payload: { code: codeAt(secret, timestamp) },
    });
    expect(reused.statusCode).toBe(400);
    vi.setSystemTime(timestamp + 30_000);
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/login/totp',
      cookies: { totpChallenge: challenge },
      payload: { code: codeAt(secret, timestamp + 30_000) },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().success).toBe(true);
    expect(
      verified.cookies.find((c) => c.name === 'sessionToken')!.maxAge
    ).toBe(7 * 24 * 60 * 60);
    const retry = await app.inject({
      method: 'POST',
      url: '/api/auth/login/totp',
      cookies: { totpChallenge: challenge },
      payload: { code: codeAt(secret, timestamp + 30_000) },
    });
    expect(retry.statusCode).toBe(400);
  });

  it('requires a session and password for registration and discards cancelled registration', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      payload: { action: 'setup', password },
    });
    expect(anonymous.statusCode).toBe(401);
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'setup', password: 'wrong' },
    });
    expect(wrongPassword.statusCode).toBe(400);
    const setup = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'setup', password },
    });
    expect(setup.statusCode).toBe(200);
    const cancelled = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'cancel' },
    });
    expect(cancelled.statusCode).toBe(200);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'confirm',
        code: codeAt(setup.json().secret, timestamp),
      },
    });
    expect(confirmed.statusCode).toBe(400);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password },
    });
    expect(login.json().success).toBe(true);
  });

  it('does not enable TOTP when saving the account fails', async () => {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'setup', password },
    });
    expect(setup.statusCode).toBe(200);
    await chmod(join(directory, 'users.json'), 0o400);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ui/totp',
        cookies: { sessionToken: cookie },
        payload: {
          action: 'confirm',
          code: codeAt(setup.json().secret, timestamp),
        },
      });
      expect(response.statusCode).toBe(500);
      const status = await app.inject({
        method: 'POST',
        url: '/api/ui/totp',
        cookies: { sessionToken: cookie },
        payload: { action: 'status' },
      });
      expect(status.json().enabled).toBe(false);
    } finally {
      await chmod(join(directory, 'users.json'), 0o600);
    }
  });
});
