import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer, ViteDevServer } from 'vite';
import { fastifyHost } from '../src/plugins/vite-plugin-fastify';
import { createUserService } from '../src/services/userService';
import { createTestDirectory } from './helpers/test-helper';

describe('Authentication through the Vite development server', () => {
  let server: ViteDevServer | undefined;
  let baseUrl: string;
  const password = 'DevelopmentLoginPassword!123';

  beforeEach(async ({ task }) => {
    const directory = await createTestDirectory('vite-auth', task.name);
    const packageDir = join(directory, 'packages');
    await mkdir(packageDir, { recursive: true });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const users = createUserService({
      configDir: directory,
      logger,
      serverConfig: { port: 5963, passwordStrengthCheck: false },
    });
    await users.initialize();
    await users.createUser({
      username: 'publisher',
      password,
      role: 'publish',
    });
    users.destroy();
    server = await createServer({
      configFile: false,
      root: directory,
      logLevel: 'silent',
      plugins: [
        fastifyHost({
          port: 5963,
          configDir: directory,
          packageDir,
          authMode: 'publish',
        }),
      ],
      server: { host: '127.0.0.1', port: 0, watch: null },
    });
    await server.listen();
    baseUrl = server.resolvedUrls!.local[0]!;
  });

  afterEach(async () => {
    await server?.close();
  });

  it('delivers the session cookie separately and authorizes package uploads after login', async () => {
    const login = await fetch(new URL('api/auth/login', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'publisher', password }),
    });
    expect(login.status).toBe(200);
    expect((await login.json()).success).toBe(true);
    const cookies = login.headers.getSetCookie();
    // Each Set-Cookie field must reach the browser separately, including deletion.
    expect(cookies).toHaveLength(2);
    expect(cookies.some((cookie) => cookie.startsWith('totpChallenge=;'))).toBe(
      true
    );
    const sessionCookie = cookies
      .find((cookie) => cookie.startsWith('sessionToken='))!
      .split(';')[0]!;
    const session = await fetch(new URL('api/auth/session', baseUrl), {
      headers: { Cookie: sessionCookie },
    });
    expect(await session.json()).toMatchObject({
      authenticated: true,
      user: { username: 'publisher', role: 'publish' },
    });
    const packageData = new Uint8Array(
      await readFile(resolve('tests/fixtures/packages/FlashCap.1.10.0.nupkg'))
    );
    const rejected = await fetch(new URL('api/publish', baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: packageData,
    });
    expect(rejected.status).toBe(401);
    const uploaded = await fetch(new URL('api/publish', baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Cookie: sessionCookie,
      },
      body: packageData,
    });
    expect(uploaded.status).toBe(201);
    expect(await uploaded.json()).toMatchObject({
      id: 'FlashCap',
      version: '1.10.0',
    });
    const logout = await fetch(new URL('api/auth/logout', baseUrl), {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.getSetCookie()).toHaveLength(2);
    const expired = await fetch(new URL('api/auth/session', baseUrl), {
      headers: { Cookie: sessionCookie },
    });
    expect((await expired.json()).authenticated).toBe(false);
  });
});
