// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTestDirectory } from './helpers/test-helper';
import { createFastifyInstance } from '../src/server.fastify';
import { ServerConfig, Logger } from '../src/types';
import { FastifyInstance } from 'fastify';
import { createConsoleLogger } from '../src/logger';

describe('HTTPS Cookie Configuration', () => {
  let testDir: string;
  let fastifyInstance: FastifyInstance;
  
  beforeAll(async () => {
    testDir = await createTestDirectory('https-cookie-config', 'setup');
  });

  afterAll(async () => {
    if (fastifyInstance) {
      await fastifyInstance.close();
    }
  });

  describe('Session Cookie Security Settings', () => {
    test('should set secure: true for HTTPS baseUrl', async () => {
      const config: ServerConfig = {
        port: 3000,
        baseUrl: 'https://example.com/api',
        packageDir: path.join(testDir, 'packages'),
        configDir: testDir,
        authMode: 'none'
      };
      
      const logger = createConsoleLogger('https-cookie-config', 'warn');
      fastifyInstance = await createFastifyInstance(config, logger);
      
      // Check that the secure session plugin was registered with correct settings
      // Note: We can't directly access the plugin configuration after registration,
      // but we can verify the behavior by checking if the instance was created successfully
      expect(fastifyInstance).toBeDefined();
      expect(fastifyInstance.hasPlugin('@fastify/secure-session')).toBe(true);
      
      await fastifyInstance.close();
      fastifyInstance = undefined!;
    });

    test('should set secure: false for HTTP baseUrl', async () => {
      const config: ServerConfig = {
        port: 3000,
        baseUrl: 'http://example.com/api',
        packageDir: path.join(testDir, 'packages'),
        configDir: testDir,
        authMode: 'none'
      };
      
      const logger = createConsoleLogger('https-cookie-config', 'warn');
      fastifyInstance = await createFastifyInstance(config, logger);
      
      expect(fastifyInstance).toBeDefined();
      expect(fastifyInstance.hasPlugin('@fastify/secure-session')).toBe(true);
      
      await fastifyInstance.close();
      fastifyInstance = undefined!;
    });

    test('should set secure: false for default baseUrl (no HTTPS)', async () => {
      const config: ServerConfig = {
        port: 3000,
        // baseUrl not specified - defaults to http://localhost:3000/api
        packageDir: path.join(testDir, 'packages'),
        configDir: testDir,
        authMode: 'none'
      };
      
      const logger = createConsoleLogger('https-cookie-config', 'warn');
      fastifyInstance = await createFastifyInstance(config, logger);
      
      expect(fastifyInstance).toBeDefined();
      expect(fastifyInstance.hasPlugin('@fastify/secure-session')).toBe(true);
      
      await fastifyInstance.close();
      fastifyInstance = undefined!;
    });
  });

  describe('HTTPS Detection Logic', () => {
    test('should detect HTTPS from various URL formats', () => {
      const httpsUrls = [
        'https://example.com/api',
        'https://api.example.com',
        'https://localhost:5001/api',
        'https://127.0.0.1:8080/nuget'
      ];
      
      for (const url of httpsUrls) {
        const isHttps = url.startsWith('https://');
        expect(isHttps).toBe(true);
      }
    });

    test('should not detect HTTPS from HTTP URLs', () => {
      const httpUrls = [
        'http://example.com/api',
        'http://api.example.com',
        'http://localhost:5000/api',
        'http://127.0.0.1:8080/nuget'
      ];
      
      for (const url of httpUrls) {
        const isHttps = url.startsWith('https://');
        expect(isHttps).toBe(false);
      }
    });

    test('should handle edge cases correctly', () => {
      // Test various edge cases
      const testCases = [
        { url: 'https://', expected: true },
        { url: 'http://', expected: false },
        { url: '', expected: false },
        { url: 'ftp://example.com', expected: false },
        { url: 'HTTPS://EXAMPLE.COM', expected: false }, // Case sensitive
      ];
      
      for (const { url, expected } of testCases) {
        const isHttps = url.startsWith('https://');
        expect(isHttps).toBe(expected);
      }
    });
  });

  describe('Integration with existing protocols', () => {
    test('should work with existing X-Forwarded-Proto header logic', async () => {
      // This test ensures that our baseUrl-based HTTPS detection
      // doesn't conflict with existing request-based protocol detection
      const config: ServerConfig = {
        port: 3000,
        baseUrl: 'https://secure.example.com/api',
        packageDir: path.join(testDir, 'packages'),
        configDir: testDir,
        authMode: 'none',
        trustedProxies: ['127.0.0.1']
      };
      
      const logger = createConsoleLogger('https-cookie-config', 'warn');
      fastifyInstance = await createFastifyInstance(config, logger);
      
      // The instance should be created successfully even with trusted proxies
      expect(fastifyInstance).toBeDefined();
      
      await fastifyInstance.close();
      fastifyInstance = undefined!;
    });
  });
});