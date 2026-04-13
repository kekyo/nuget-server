// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createUserService, UserService } from '../src/services/userService';
import { createTestDirectory } from './helpers/test-helper';

describe('userService', () => {
  let userService: UserService;
  let testDir: string;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter++;
    testDir = await createTestDirectory(
      'user-service',
      `test-${testCounter}-${Date.now()}`
    );

    userService = createUserService({
      configDir: testDir,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      } as any,
    });

    await userService.initialize();
  });

  afterEach(() => {
    userService.destroy();
  });

  it('should rollback user creation when users.json cannot be persisted', async () => {
    const usersFilePath = join(testDir, 'users.json');

    await fs.writeFile(usersFilePath, '[]', 'utf-8');
    await fs.chmod(usersFilePath, 0o444);

    try {
      await expect(
        userService.createUser({
          username: 'testuser',
          password: 'Test123!@#',
          role: 'publish',
        })
      ).rejects.toMatchObject({
        code: 'EACCES',
      });

      expect(await userService.getUser('testuser')).toBeUndefined();
      expect(await userService.getUserCount()).toBe(0);
      expect(await userService.getAllUsers()).toEqual([]);
      expect(await fs.readFile(usersFilePath, 'utf-8')).toBe('[]');
    } finally {
      await fs.chmod(usersFilePath, 0o644);
    }
  });
});
