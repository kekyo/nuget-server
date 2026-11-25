import { expect, it, vi } from 'vitest';
import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashPassword } from '../src/utils/crypto.ts';
import { createUserService } from '../src/services/userService.ts';
import { createTestDirectory } from './helpers/test-helper.ts';

it('resets only the selected password through the stopped-server CLI', async () => {
  const dir = await createTestDirectory('credentials', 'offline reset');
  const file = join(dir, 'accounts.json');
  const accounts = ['alice', 'bob'].map((username, index) => ({
    username,
    id: String(index),
    salt: 'fixture',
    passwordHash: 'legacy',
    role: index === 0 ? 'admin' : 'read',
    createdAt: '',
    updatedAt: '',
    authVersion: 4,
    totp: {
      encryptedSecret: 'offline',
      recoveryCodeHashes: [],
      lastUsedStep: 1,
      enabledAt: '',
    },
  }));
  await writeFile(file, JSON.stringify(accounts));
  const args = [
    resolve('dist/cli.mjs'),
    '--users-file',
    file,
    '--password-reset',
    'alice',
  ];
  const pass = 'Registration-Sapphire-73-Tree!';
  const run = (input: string) =>
    spawnSync(process.execPath, args, {
      input,
      encoding: 'utf8',
      timeout: 10000,
    });
  const mismatch = run(pass + '\nother\n');
  expect(mismatch.status).toBe(1);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(accounts);
  const result = run(pass + '\n' + pass + '\n');
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout + result.stderr).not.toContain(pass);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  expect(stored[0]).toMatchObject({
    id: '0',
    role: 'admin',
    totp: accounts[0]!.totp,
    authVersion: 5,
  });
  expect(stored[0].passwordHash).toMatch(/^scrypt\$/);
  expect(stored[1]).toEqual(accounts[1]);
});

it('bounds queued password work and reports temporary overload', async () => {
  const jobs = Array.from(
    { length: 11 },
    async () => await hashPassword('fixture', 'example-salt-12345')
  );
  const results = await Promise.allSettled(jobs);
  expect(results.filter((r) => r.status === 'rejected')).toMatchObject([
    { reason: { statusCode: 503, headers: { 'Retry-After': '1' } } },
  ]);
  expect(await hashPassword('fixture', 'example-salt-12345')).toMatch(
    /^scrypt\$/
  );
}, 30_000);

it('separates human passwords from random API passwords and rejects stale account revisions', async () => {
  const dir = await createTestDirectory('credentials', 'formats');
  const users = createUserService({
    configDir: dir,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    serverConfig: { port: 0, passwordStrengthCheck: false },
  });
  try {
    await users.initialize();
    const password = 'example-password';
    const alice = await users.createUser({
      username: 'alice',
      password,
      role: 'admin',
    });
    const bob = await users.createUser({
      username: 'bob',
      password,
      role: 'read',
    });
    expect(alice.passwordHash).toMatch(/^scrypt\$/);
    expect(bob.passwordHash).not.toBe(alice.passwordHash);
    const token = (await users.addApiPassword('alice', 'fixture'))!;
    expect(
      (await users.getUser('alice'))!.apiPasswords![0]!.passwordHash
    ).toMatch(/^sha256\$/);
    expect(
      (await users.validateApiPassword('alice', token.apiPassword))?.id
    ).toBe(alice.id);
    expect(
      await users.validateApiPassword('alice', token.apiPassword + 'extra')
    ).toBeUndefined();
    expect(
      await users.validateCredentials('alice', token.apiPassword)
    ).toBeUndefined();
    await users.updateUser('alice', { password: 'new-example-password' });
    expect(
      (await users.validateCredentials('alice', 'new-example-password'))?.id
    ).toBe(alice.id);
    expect(
      await users.updateUser(
        'alice',
        { password: 'superseded-password' },
        alice
      )
    ).toBeUndefined();
    expect(
      await users.addApiPassword('alice', 'superseded login', alice)
    ).toBeUndefined();
    expect((await users.validateCredentials('bob', password))?.role).toBe(
      'read'
    );
  } finally {
    users.destroy();
  }
});

it('upgrades a verified legacy password once and retains the change reminder across restarts', async () => {
  const dir = await createTestDirectory('credentials', 'legacy password');
  const file = join(dir, 'users.json');
  const original = {
    id: 'legacy-id',
    username: 'alice',
    role: 'publish',
    salt: 'legacy-salt',
    passwordHash: 'SOvUmqH2BOLjR7bnt38nsurOooc=',
    authVersion: 7,
    createdAt: '',
    updatedAt: '',
    totp: {
      encryptedSecret: 'offline fixture',
      recoveryCodeHashes: [],
      lastUsedStep: 9,
      enabledAt: '',
    },
  };
  await writeFile(file, JSON.stringify([original]));
  const users = createUserService({
    configDir: dir,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    serverConfig: { port: 0, passwordStrengthCheck: false },
  });
  try {
    await users.initialize();
    expect(
      await users.validateCredentials('alice', 'wrong-password')
    ).toBeUndefined();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([original]);
    const attempts = await Promise.all([
      users.validateCredentials('alice', 'example-password'),
      users.validateCredentials('alice', 'example-password'),
    ]);
    for (const who of attempts)
      expect(who).toMatchObject({
        id: original.id,
        authVersion: 7,
        passwordChangeRecommended: true,
      });
    const [saved] = JSON.parse(await readFile(file, 'utf8'));
    expect(saved).toMatchObject({
      role: original.role,
      totp: original.totp,
      authVersion: 7,
      passwordChangeRecommended: true,
    });
    expect(saved.passwordHash).toMatch(/^scrypt\$/);
    expect(saved.salt).not.toBe(original.salt);
    users.destroy();
    await users.initialize();
    expect(
      (await users.validateCredentials('alice', 'example-password'))
        ?.passwordHash
    ).toBe(saved.passwordHash);
    await expect(
      users.updateUser('alice', { password: 'example-password' })
    ).rejects.toThrow(/different/i);
    await users.updateUser('alice', { role: 'admin' });
    expect((await users.getUser('alice'))?.passwordChangeRecommended).toBe(
      true
    );
    await users.updateUser('alice', { password: 'new-example-password' });
    expect(
      (await users.validateCredentials('alice', 'new-example-password'))
        ?.passwordChangeRecommended
    ).toBeUndefined();
    expect(
      await users.validateCredentials('alice', 'example-password')
    ).toBeUndefined();
    expect((await users.getUser('alice'))?.authVersion).toBe(9);
  } finally {
    users.destroy();
  }
});

it('updates only the matching legacy API password and keeps its value, identity and revocation working', async () => {
  const dir = await createTestDirectory('credentials', 'legacy tokens');
  const file = join(dir, 'users.json');
  const original = {
    label: 'build',
    createdAt: '2020-01-01',
    salt: 'legacy-salt',
    passwordHash: 'b0X5eBwEa4H46BrL6qolMlJuW0Q=',
  };
  const unused = {
    ...original,
    salt: 'different-salt',
    label: 'release',
  };
  const incomplete = { label: 'incomplete', createdAt: '' };
  const user = {
    id: 'old-user',
    username: 'alice',
    role: 'admin',
    salt: 'legacy-salt',
    passwordHash: 'SOvUmqH2BOLjR7bnt38nsurOooc=',
    authVersion: 8,
    apiPasswords: [incomplete, unused, original],
  };
  const incompletePassword = {
    ...user,
    id: 'incomplete-password',
    username: 'bob',
    passwordHash: await hashPassword('example-password', 'missing-salt'),
    salt: undefined,
    apiPasswords: [],
  };
  const accounts = [user, incompletePassword];
  await writeFile(file, JSON.stringify(accounts));
  const users = createUserService({
    configDir: dir,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  try {
    await users.initialize();
    expect(
      await users.validateCredentials('bob', 'example-password')
    ).toBeUndefined();
    expect(
      await users.validateApiPassword('alice', 'invalid-token')
    ).toBeUndefined();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(accounts);
    expect(
      (await users.validateApiPassword('alice', 'build-api-key'))?.id
    ).toBe(user.id);
    const [saved] = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.apiPasswords.slice(0, 2)).toEqual([incomplete, unused]);
    expect(saved.apiPasswords[2]).toMatchObject({
      label: original.label,
      createdAt: original.createdAt,
      rotationRecommended: true,
      passwordHash: expect.stringMatching(/^sha256\$/),
    });
    expect(saved.apiPasswords[2]).not.toHaveProperty('salt');
    expect(saved.passwordHash).toBe(user.passwordHash);
    expect(saved.authVersion).toBe(8);
    users.destroy();
    await users.initialize();
    expect(
      (await users.validateApiPassword('alice', 'build-api-key'))?.id
    ).toBe(user.id);
    await users.deleteApiPassword('alice', 'build');
    expect(
      await users.validateApiPassword('alice', 'build-api-key')
    ).toBeUndefined();
  } finally {
    users.destroy();
  }
});

it('rolls back failed conversions and never overwrites a password changed since verification began', async () => {
  const dir = await createTestDirectory('credentials', 'migration persistence');
  const file = join(dir, 'users.json');
  const original = {
    id: 'fixture',
    username: 'alice',
    role: 'admin',
    salt: 'legacy-salt',
    passwordHash: 'SOvUmqH2BOLjR7bnt38nsurOooc=',
    apiPasswords: [
      {
        label: 'CI',
        createdAt: '',
        salt: 'legacy-salt',
        passwordHash: 'b0X5eBwEa4H46BrL6qolMlJuW0Q=',
      },
    ],
  };
  await writeFile(file, JSON.stringify([original]));
  const users = createUserService({
    configDir: dir,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    serverConfig: { port: 0, passwordStrengthCheck: false },
  });
  try {
    await users.initialize();
    await rename(file, file + '.backup');
    await mkdir(file);
    await expect(
      users.validateCredentials('alice', 'example-password')
    ).rejects.toThrow();
    await expect(
      users.validateApiPassword('alice', 'build-api-key')
    ).rejects.toThrow();
    expect(await users.getUser('alice')).toMatchObject(original);
    await rmdir(file);
    await rename(file + '.backup', file);
    const before = await users.getUser('alice');
    await users.updateUser('alice', { password: 'replacement-password' });
    // Model verification which already read the old snapshot when another request reset the password.
    vi.spyOn(users, 'getUser').mockResolvedValueOnce(before);
    expect(
      await users.validateCredentials('alice', 'example-password')
    ).toBeUndefined();
    expect(
      (await users.validateCredentials('alice', 'replacement-password'))?.id
    ).toBe(original.id);
    expect(
      (await users.getUser('alice'))?.passwordChangeRecommended
    ).toBeUndefined();
  } finally {
    users.destroy();
    vi.restoreAllMocks();
  }
});
