import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createReaderWriterLock } from 'async-primitives';
import { FastifyInstance } from 'fastify';
import { TOTP } from 'otpauth';
import { createFastifyInstance } from '../src/server';
import { createUserService } from '../src/services/userService';
import { createTestDirectory } from './helpers/test-helper';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const password = 'TotpRecoveryPassword!123';
const now = 1_800_000_000_000;

describe('TOTP recovery and authenticator replacement', () => {
  let app: FastifyInstance;
  let directory: string;
  let cookie: string;
  let secret: string;
  let recoveryCodes: string[];

  beforeEach(async ({ task }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    vi.stubEnv('NUGET_SERVER_AUTH_FAILURE_DELAY_ENABLED', 'false');
    directory = await createTestDirectory('totp-recovery', task.name);
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
        passwordStrengthCheck: false,
      },
      logger,
      createReaderWriterLock()
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password },
    });
    cookie = login.cookies.find((c) => c.name === 'sessionToken')!.value;
    const setup = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'setup', password },
    });
    secret = setup.json().secret;
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'confirm',
        code: new TOTP({ secret }).generate({ timestamp: now }),
      },
    });
    expect(confirm.statusCode).toBe(200);
    cookie = confirm.cookies.find((c) => c.name === 'sessionToken')!.value;
    recoveryCodes = confirm.json().recoveryCodes;
    vi.setSystemTime(now + 30_000);
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('consumes recovery codes once, including after a server restart', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password },
    });
    const token = login.cookies.find((c) => c.name === 'totpChallenge')!.value;
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/login/totp',
      cookies: { totpChallenge: token },
      payload: { code: recoveryCodes[0], recovery: true },
    });
    expect(verified.statusCode).toBe(200);
    await app.close();
    app = await createFastifyInstance(
      {
        port: 5963,
        configDir: directory,
        packageDir: join(directory, 'packages'),
        authMode: 'full',
      },
      logger,
      createReaderWriterLock()
    );
    const loginAgain = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password },
    });
    const newToken = loginAgain.cookies.find(
      (c) => c.name === 'totpChallenge'
    )!.value;
    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/login/totp',
      cookies: { totpChallenge: newToken },
      payload: { code: recoveryCodes[0], recovery: true },
    });
    expect(reused.statusCode).toBe(400);
    const unused = await app.inject({
      method: 'POST',
      url: '/api/auth/login/totp',
      cookies: { totpChallenge: newToken },
      payload: { code: recoveryCodes[1], recovery: true },
    });
    expect(unused.statusCode).toBe(200);
  });

  it('requires password and a second factor to disable TOTP and invalidates sessions', async () => {
    const missingFactor = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'disable', password },
    });
    expect(missingFactor.statusCode).toBe(400);
    const disabled = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'disable',
        password,
        code: recoveryCodes[0],
        recovery: true,
      },
    });
    expect(disabled.statusCode).toBe(200);
    const staleSession = await app.inject({
      url: '/api/auth/session',
      cookies: { sessionToken: cookie },
    });
    expect(staleSession.json().authenticated).toBe(false);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password },
    });
    expect(login.json().success).toBe(true);
    expect(
      JSON.parse(await readFile(join(directory, 'users.json'), 'utf8'))[0].totp
    ).toBeUndefined();
  });

  it('keeps the existing authenticator active until its replacement is confirmed', async () => {
    const replaced = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'setup',
        password,
        code: recoveryCodes[0],
        recovery: true,
      },
    });
    expect(replaced.statusCode).toBe(200);
    const pendingSecret = replaced.json().secret;
    const before = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'status' },
    });
    expect(before.json().enabled).toBe(true);
    const cancel = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: { action: 'cancel' },
    });
    expect(cancel.statusCode).toBe(200);
    const cancelledConfirm = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'confirm',
        code: new TOTP({ secret: pendingSecret }).generate(),
      },
    });
    expect(cancelledConfirm.statusCode).toBe(400);
    const setup = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'setup',
        password,
        code: recoveryCodes[1],
        recovery: true,
      },
    });
    expect(setup.statusCode).toBe(200);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'confirm',
        code: new TOTP({ secret: setup.json().secret }).generate(),
      },
    });
    expect(confirmed.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password },
    });
    const challenge = login.cookies.find(
      (c) => c.name === 'totpChallenge'
    )!.value;
    const oldRecovery = await app.inject({
      method: 'POST',
      url: '/api/auth/login/totp',
      cookies: { totpChallenge: challenge },
      payload: { code: recoveryCodes[2], recovery: true },
    });
    expect(oldRecovery.statusCode).toBe(400);
    const newRecovery = await app.inject({
      method: 'POST',
      url: '/api/auth/login/totp',
      cookies: { totpChallenge: challenge },
      payload: { code: confirmed.json().recoveryCodes[0], recovery: true },
    });
    expect(newRecovery.statusCode).toBe(200);
  });

  it('replaces the recovery codes only after reauthentication', async () => {
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'recovery',
        password: 'wrong',
        code: recoveryCodes[0],
        recovery: true,
      },
    });
    expect(rejected.statusCode).toBe(400);
    const regenerated = await app.inject({
      method: 'POST',
      url: '/api/ui/totp',
      cookies: { sessionToken: cookie },
      payload: {
        action: 'recovery',
        password,
        code: recoveryCodes[0],
        recovery: true,
      },
    });
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json().recoveryCodes).toHaveLength(10);
    expect(regenerated.json().recoveryCodes).not.toEqual(recoveryCodes);
    const stale = await app.inject({
      url: '/api/auth/session',
      cookies: { sessionToken: cookie },
    });
    expect(stale.json().authenticated).toBe(false);
  });
});
