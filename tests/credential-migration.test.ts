// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createReaderWriterLock } from 'async-primitives';
import { createFastifyInstance } from '../src/server.ts';
import { generateSalt, hashPassword } from '../src/utils/crypto.ts';
import { createTestDirectory } from './helpers/test-helper.ts';

it('reports migration to the account holder and admin while existing NuGet clients keep working', async () => {
  const configDir = await createTestDirectory(
    'credentials',
    'migration routes'
  );
  const packageDir = join(configDir, 'packages');
  await mkdir(packageDir, { recursive: true });
  const legacy = {
    id: 'alice-id',
    username: 'alice',
    role: 'publish',
    salt: 'legacy-salt',
    passwordHash: 'SOvUmqH2BOLjR7bnt38nsurOooc=',
    createdAt: '2020-01-01',
    updatedAt: '2020-01-01',
  };
  const token = {
    label: 'build',
    salt: 'legacy-salt',
    passwordHash: 'b0X5eBwEa4H46BrL6qolMlJuW0Q=',
    createdAt: '2020-01-01',
  };
  const adminSalt = generateSalt();
  const admin = {
    ...legacy,
    id: 'admin-id',
    username: 'owner',
    role: 'admin',
    salt: adminSalt,
    passwordHash: await hashPassword('owner-password', adminSalt),
  };
  await writeFile(
    join(configDir, 'users.json'),
    JSON.stringify([
      admin,
      { ...legacy, apiPasswords: [token] },
      { ...legacy, id: 'idle-id', username: 'idle' },
    ])
  );
  const app = await createFastifyInstance(
    {
      configDir,
      packageDir,
      port: 0,
      authMode: 'full',
      passwordStrengthCheck: false,
    },
    { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    createReaderWriterLock()
  );
  const login = async (username: string, password: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    });
    expect(response.statusCode).toBe(200);
    return {
      sessionToken: response.cookies.find(
        (cookie) => cookie.name === 'sessionToken'
      )!.value,
    };
  };
  const list = async (path: string, cookies: { sessionToken: string }) =>
    await app.inject({
      method: 'POST',
      url: '/api/ui/' + path,
      cookies,
      payload: { action: 'list' },
    });
  const nugetIndex = async () =>
    await app.inject({
      url: '/v3/index.json',
      headers: {
        authorization:
          'Basic ' + Buffer.from('alice:build-api-key').toString('base64'),
      },
    });
  try {
    expect(
      (await app.inject({ url: '/api/config' })).json().currentUser
    ).toBeNull();
    const owner = await login('owner', 'owner-password');
    const before = (await list('users', owner)).json();
    expect(before.credentialMigration).toEqual({
      passwords: 2,
      apiPasswords: 1,
    });
    expect(before.users[1]).not.toHaveProperty('passwordHash');
    expect(before.users[1]).not.toHaveProperty('apiPasswords');

    const alice = await login('alice', 'example-password');
    const session = await app.inject({
      url: '/api/auth/session',
      cookies: alice,
    });
    expect(session.json().user.passwordChangeRecommended).toBe(true);
    for (const method of ['GET', 'POST'] as const) {
      const url = method === 'GET' ? '/api/config' : '/api/ui/config';
      const response = await app.inject({ method, url, cookies: alice });
      expect(response.json().currentUser.passwordChangeRecommended).toBe(true);
    }
    expect((await list('users', alice)).statusCode).toBe(403);
    const tokens = (await list('apipasswords', alice)).json().apiPasswords;
    expect(
      tokens.find((entry: { label: string }) => entry.label === token.label)
    ).toEqual({
      label: token.label,
      createdAt: token.createdAt,
      migrationStatus: 'pending',
    });
    expect(
      tokens.filter(
        (entry: { migrationStatus?: string }) => entry.migrationStatus
      )
    ).toHaveLength(1);
    expect((await nugetIndex()).statusCode).toBe(200);
    const used = (await list('apipasswords', alice))
      .json()
      .apiPasswords.find(
        (entry: { label: string }) => entry.label === token.label
      );
    expect(used.migrationStatus).toBe('upgraded');
    expect((await list('users', owner)).json().credentialMigration).toEqual({
      passwords: 1,
      apiPasswords: 0,
    });

    const change = await app.inject({
      method: 'POST',
      url: '/api/ui/password',
      cookies: alice,
      payload: {
        currentPassword: 'example-password',
        newPassword: 'replacement-password',
      },
    });
    expect(change.json().success).toBe(true);
    expect(
      (await app.inject({ url: '/api/auth/session', cookies: alice })).json()
        .authenticated
    ).toBe(false);
    const renewed = await login('alice', 'replacement-password');
    expect(
      (await app.inject({ url: '/api/config', cookies: renewed })).json()
        .currentUser
    ).not.toHaveProperty('passwordChangeRecommended');
    expect((await nugetIndex()).statusCode).toBe(200);
    const revoke = await app.inject({
      method: 'POST',
      url: '/api/ui/apipasswords',
      cookies: renewed,
      payload: { action: 'delete', label: token.label },
    });
    expect(revoke.json().success).toBe(true);
    expect((await nugetIndex()).statusCode).toBe(401);
  } finally {
    await app.close();
  }
}, 30_000);
