import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TOTP } from 'otpauth';
import { createUserService } from '../src/services/userService';
import { createTotpService } from '../src/services/totpService';
import { createTestDirectory } from './helpers/test-helper';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const password = 'TotpSecurityPassword!123';
const now = 1_800_000_000_000;
const ip = '192.0.2.1';

describe('TOTP security boundaries', () => {
  let users: ReturnType<typeof createUserService>;
  let totp: ReturnType<typeof createTotpService>;
  let directory: string;
  let secret: string;
  let recoveryCodes: string[];

  beforeEach(async ({ task }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    directory = await createTestDirectory('totp-security', task.name);
    users = createUserService({
      configDir: directory,
      logger,
      serverConfig: { port: 5963, passwordStrengthCheck: false },
    });
    await users.initialize();
    const user = await users.createUser({
      username: 'alice',
      password,
      role: 'admin',
    });
    totp = createTotpService({
      users,
      keyFile: join(directory, 'totp.key'),
      issuer: 'Registry / テスト',
    });
    await totp.initialize();
    const setup = await totp.setup(user, 'session', password, ip, '', false);
    secret = setup.secret;
    const confirmed = await totp.confirm(
      'session',
      new TOTP({ secret }).generate(),
      ip
    );
    recoveryCodes = confirmed.recoveryCodes;
    vi.setSystemTime(now + 30_000);
  });

  afterEach(() => {
    totp.destroy();
    users.destroy();
    vi.useRealTimers();
  });

  it('accepts a time step only once across concurrent login challenges and restarts', async () => {
    const user = (await users.getUser('alice'))!;
    const challenges = [
      totp.beginLogin(user, false, ip),
      totp.beginLogin(user, false, ip),
    ];
    const code = new TOTP({ secret }).generate();
    const results = await Promise.allSettled(
      challenges.map(
        async (token) => await totp.verifyLogin(token, code, ip, false)
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    totp.destroy();
    users.destroy();
    await users.initialize();
    totp = createTotpService({
      users,
      keyFile: join(directory, 'totp.key'),
      issuer: 'Registry',
    });
    await totp.initialize();
    const token = totp.beginLogin((await users.getUser('alice'))!, false, ip);
    await expect(totp.verifyLogin(token, code, ip, false)).rejects.toThrow(
      'TOTP_INVALID'
    );
  });

  it('expires challenges and limits attempts independently of password verification', async () => {
    const user = (await users.getUser('alice'))!;
    const expired = totp.beginLogin(user, false, ip);
    vi.setSystemTime(now + 330_001);
    await expect(
      totp.verifyLogin(expired, recoveryCodes[0]!, ip, true)
    ).rejects.toThrow('TOTP_EXPIRED');
    for (let round = 0; round < 2; round++) {
      const token = totp.beginLogin(user, false, ip);
      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(
          totp.verifyLogin(token, 'invalid', ip, false)
        ).rejects.toThrow('TOTP_INVALID');
        expect(
          await users.validateCredentials('alice', password)
        ).toBeDefined();
      }
      await expect(
        totp.verifyLogin(token, recoveryCodes[0]!, ip, true)
      ).rejects.toThrow('TOTP_EXPIRED');
    }
    expect(() => totp.beginLogin(user, false, '192.0.2.2')).toThrow(
      'TOTP_RATE_LIMITED'
    );
    vi.setSystemTime(now + 930_002);
    const token = totp.beginLogin(user, false, ip);
    expect(
      (await totp.verifyLogin(token, recoveryCodes[0]!, ip, true)).user.username
    ).toBe('alice');
  });

  it('allows adjacent clock steps but rejects steps outside the window', async () => {
    const user = (await users.getUser('alice'))!;
    const token = totp.beginLogin(user, false, ip);
    await expect(
      totp.verifyLogin(
        token,
        new TOTP({ secret }).generate({ timestamp: now + 90_000 }),
        ip,
        false
      )
    ).rejects.toThrow('TOTP_INVALID');
    await totp.verifyLogin(
      token,
      new TOTP({ secret }).generate({ timestamp: now + 60_000 }),
      ip,
      false
    );
    const second = totp.beginLogin(user, false, ip);
    await expect(
      totp.verifyLogin(
        second,
        new TOTP({ secret }).generate({ timestamp: now + 30_000 }),
        ip,
        false
      )
    ).rejects.toThrow('TOTP_INVALID');
  });

  it('preserves recovery codes if persisting their consumption fails', async () => {
    const token = totp.beginLogin((await users.getUser('alice'))!, false, ip);
    const file = join(directory, 'users.json');
    const before = await readFile(file, 'utf8');
    await chmod(file, 0o400);
    try {
      await expect(
        totp.verifyLogin(token, recoveryCodes[0]!, ip, true)
      ).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe(before);
    } finally {
      await chmod(file, 0o600);
    }
    await expect(
      totp.verifyLogin(token, recoveryCodes[0]!, ip, true)
    ).resolves.toBeDefined();
  });

  it('invalidates pending logins and registrations when a password changes', async () => {
    const user = (await users.getUser('alice'))!;
    const token = totp.beginLogin(user, false, ip);
    const setup = await totp.setup(
      user,
      'replacement',
      password,
      ip,
      recoveryCodes[0]!,
      true
    );
    await users.updateUser('alice', { password: 'ChangedPassword!123' });
    await expect(
      totp.verifyLogin(token, recoveryCodes[1]!, ip, true)
    ).rejects.toThrow('TOTP_EXPIRED');
    await expect(
      totp.confirm(
        'replacement',
        new TOTP({ secret: setup.secret }).generate(),
        ip
      )
    ).rejects.toThrow('TOTP_EXPIRED');
    expect((await users.getUser('alice'))!.totp).toBeDefined();
  });

  it('fails closed when the key is missing or replaced and keeps private permissions', async () => {
    const keyFile = join(directory, 'totp.key');
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, 'users.json'))).mode & 0o777).toBe(
      0o600
    );
    totp.destroy();
    await rm(keyFile);
    await expect(totp.initialize()).rejects.toThrow();
    await expect(
      totp.setup(
        (await users.getUser('alice'))!,
        'new',
        password,
        ip,
        recoveryCodes[0]!,
        true
      )
    ).rejects.toThrow();
    await expect(stat(keyFile)).rejects.toThrow();
    await writeFile(keyFile, Buffer.alloc(32, 42));
    await expect(totp.initialize()).rejects.toThrow();
  });

  it('binds encrypted secrets to the account identity', async () => {
    const alice = (await users.getUser('alice'))!;
    const bob = await users.createUser({
      username: 'bob',
      password,
      role: 'read',
    });
    await users.mutateTotp(bob.username, 0, () => alice.totp, true);
    await expect(totp.initialize()).rejects.toThrow();
  });
});
