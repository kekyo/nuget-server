import { describe, expect, it, vi } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createUserService } from '../src/services/userService';
import { runTotpReset } from '../src/totpReset';
import { createTestDirectory } from './helpers/test-helper';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('Offline TOTP reset', () => {
  it('resets only the selected user without needing the encryption key', async () => {
    const directory = await createTestDirectory('totp-reset', 'targeted reset');
    const config = {
      port: 5963,
      configDir: directory,
      usersFile: join(directory, 'accounts.json'),
      passwordStrengthCheck: false,
    };
    const users = createUserService({
      configDir: directory,
      usersFile: config.usersFile,
      logger,
      serverConfig: config,
    });
    await users.initialize();
    const alice = await users.createUser({
      username: 'alice',
      password: 'test-password',
      role: 'admin',
    });
    const bob = await users.createUser({
      username: 'bob',
      password: 'other-password',
      role: 'read',
    });
    await users.addApiPassword('alice', 'build agent');
    const credentials = {
      encryptedSecret: 'unavailable-key',
      lastUsedStep: 1,
      recoveryCodeHashes: ['used-for-test'],
      enabledAt: new Date().toISOString(),
    };
    await users.mutateTotp(alice.username, 0, () => credentials, true);
    await users.mutateTotp(bob.username, 0, () => credentials, true);
    users.destroy();
    const before = JSON.parse(await readFile(config.usersFile, 'utf8'));
    await runTotpReset(config, logger, 'alice');
    const after = JSON.parse(await readFile(config.usersFile, 'utf8'));
    expect(after[0].totp).toBeUndefined();
    expect(after[0].authVersion).toBe(before[0].authVersion + 1);
    expect(after[0].passwordHash).toBe(before[0].passwordHash);
    expect(after[0].apiPasswords).toEqual(before[0].apiPasswords);
    expect(after[1]).toEqual(before[1]);
    await expect(runTotpReset(config, logger, 'missing')).rejects.toThrow(
      'User not found'
    );
    await rm(directory, { recursive: true, force: true });
  });
});
