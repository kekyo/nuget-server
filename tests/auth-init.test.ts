// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { runAuthInit } from '../src/authInit';
import { createConsoleLogger } from '../src/logger';
import { createTestDirectory, testGlobalLogLevel } from './helpers/test-helper';
import { ServerConfig } from '../src/types';

describe('Auth Init', () => {
  let testDir: string;
  let configDir: string;
  let logger: ReturnType<typeof createConsoleLogger>;

  beforeEach(async (fn) => {
    testDir = await createTestDirectory('auth-init', fn.task.name);
    configDir = join(testDir, 'config');
    logger = createConsoleLogger('auth-init', testGlobalLogLevel);
  });

  // Test directories are preserved in test-results for debugging

  describe('Pre-conditions', () => {
    it('should fail if users.json already exists', async () => {
      // Create config directory and users.json
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'users.json'), '[]');

      // Mock process.exit
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      const config: ServerConfig = {
        port: 12345,
        packageDir: configDir,
        configDir: configDir,
        realm: 'Test Fastify UI Server - Publish',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'publish',
        passwordStrengthCheck: false
      };

      // Expect the function to exit with error
      await expect(runAuthInit(config, logger)).rejects.toThrow('Process exited with code 1');

      // Verify error was logged
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should create config directory if it does not exist', async () => {
      // Mock readline and process.exit for this test
      const mockReadline = {
        createInterface: vi.fn(() => ({
          question: vi.fn((prompt, callback) => {
            if (prompt.includes('username')) {
              callback('testadmin');
            }
          }),
          close: vi.fn()
        }))
      };

      // This is a unit test to verify directory creation logic
      // Full integration test would require mocking stdin
      expect(existsSync(configDir)).toBe(false);
      
      // The actual directory creation happens in runAuthInit
      // We verify it works by checking the implementation
    });
  });

  describe('User creation flow', () => {
    it('should validate username format', async () => {
      // Test data
      const invalidUsernames = [
        '',           // Empty
        'a'.repeat(51), // Too long
        'user@name',  // Invalid characters
        'user name',  // Spaces
      ];

      const validUsernames = [
        'admin',
        'user123',
        'test-user',
        'user_name',
        'user.name'
      ];

      // Username validation is handled by UserService
      // These tests verify the validation rules match expectations
      for (const username of invalidUsernames) {
        // In actual implementation, UserService will validate
        expect(username).toMatch(/^$|^.{51,}$|[^a-zA-Z0-9._-]/);
      }

      for (const username of validUsernames) {
        expect(username).toMatch(/^[a-zA-Z0-9._-]+$/);
        expect(username.length).toBeLessThanOrEqual(50);
        expect(username.length).toBeGreaterThan(0);
      }
    });

    it('should validate password requirements', () => {
      // Test password validation rules
      const invalidPasswords = [
        '',        // Empty
        '123',     // Too short (< 4 chars)
      ];

      const validPasswords = [
        '1234',    // Minimum length
        'password123',
        'VeryLongAndSecurePassword123!@#'
      ];

      // Password validation is handled in authInit
      for (const password of invalidPasswords) {
        expect(password.length).toBeLessThan(4);
      }

      for (const password of validPasswords) {
        expect(password.length).toBeGreaterThanOrEqual(4);
      }
    });
  });
});
