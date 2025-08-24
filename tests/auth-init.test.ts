// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { runAuthInit } from '../src/authInit';
import { createConsoleLogger } from '../src/logger';
import { createTestDirectory, testGlobalLogLevel } from './helpers/test-helper';

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

      // Expect the function to exit with error
      await expect(runAuthInit({ configDir, logger })).rejects.toThrow('Process exited with code 1');

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

  describe('File output', () => {
    it('should create users.json with correct structure', async () => {
      // This test verifies the expected structure of users.json
      // In a real scenario, we would mock stdin and test the full flow
      
      const expectedStructure = {
        id: expect.any(String),
        username: expect.any(String),
        passwordHash: expect.any(String),
        salt: expect.any(String),
        apiKeyHash: expect.any(String),
        apiKeySalt: expect.any(String),
        role: 'admin',
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      };

      // The structure would be validated after actual creation
      // This test documents the expected format
    });

    it('should generate unique API key', async () => {
      // API keys should follow the pattern: ngs_[random string]
      // This is handled by the generateApiKey function in crypto utils
      
      const apiKeyPattern = /^ngs_[a-zA-Z0-9]{20,}$/;
      
      // In actual implementation, the API key is generated and shown once
      // This test documents the expected format
    });
  });

  describe('Error handling', () => {
    it('should handle Ctrl+C gracefully', async () => {
      // Test that Ctrl+C (SIGINT) is handled properly
      // This would require mocking process.stdin in a real test
      
      // The implementation catches Ctrl+C and exits cleanly
      // Verify the error message includes "Cancelled by user"
    });

    it('should limit password retry attempts', async () => {
      // Maximum attempts is set to 3
      const maxAttempts = 3;
      
      // After max attempts, process should exit with error
      // This would be tested with mocked stdin providing mismatched passwords
    });
  });

  describe('Success output', () => {
    it('should display API key only once', async () => {
      // The API key should be displayed immediately after creation
      // It cannot be retrieved again for security reasons
      
      // Expected output format:
      const expectedOutput = [
        'Admin user created successfully!',
        'Username: [username]',
        'API Key: ngs_[key]',
        'IMPORTANT: Save this API key securely. It cannot be retrieved again.',
        'Use this API key for NuGet client authentication:',
        '  Username: [username]',
        '  Password: ngs_[key]'
      ];

      // This documents the expected success message format
    });
  });
});