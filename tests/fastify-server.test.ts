import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { startFastifyServer, FastifyServerInstance } from '../src/server';
import { createConsoleLogger } from '../src/logger';
import { ServerConfig } from '../src/types';
import {
  createTestDirectory,
  getTestPort,
  testGlobalLogLevel,
} from './helpers/test-helper.js';

/**
 * Fastify Server Basic Tests - Phase 1
 *
 * Tests basic Fastify server functionality including:
 * - Server startup and shutdown
 * - Basic endpoint availability
 * - Health check endpoint
 * - Configuration endpoint (when UI enabled)
 * - Parallel operation with Express server
 */
describe('Fastify Server - Phase 1 Basic Tests', () => {
  let testBaseDir: string;
  let testPackagesDir: string;
  let testConfigDir: string;
  let serverPort: number;

  beforeEach(async (fn) => {
    // Create isolated test directory for each test
    testBaseDir = await createTestDirectory(
      'fastify-server-phase1',
      fn.task.name
    );
    testPackagesDir = path.join(testBaseDir, 'packages');
    testConfigDir = testBaseDir;

    // Create packages directory to avoid warnings
    await fs.mkdir(testPackagesDir, { recursive: true });

    // Generate unique port for each test
    serverPort = getTestPort(6000);
  });

  test('should start Fastify server successfully', async () => {
    const logger = createConsoleLogger('fastify-server', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Fastify Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(testConfig, logger);
    try {
      expect(server).toBeDefined();
      expect(typeof server.close).toBe('function');
    } finally {
      await server.close();
    }
  }, 30000);

  test('should respond to health check endpoint', async () => {
    const logger = createConsoleLogger('fastify-server', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Fastify Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(testConfig, logger);
    try {
      const response = await fetch(`http://localhost:${serverPort}/health`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({
        status: 'ok',
        version: expect.any(String),
      });
    } finally {
      await server.close();
    }
  }, 30000);

  test('should respond to root endpoint with HTML UI when UI enabled', async () => {
    const logger = createConsoleLogger('fastify-server', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Fastify Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(testConfig, logger);
    try {
      const response = await fetch(`http://localhost:${serverPort}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<title>nuget-server</title>');
    } finally {
      await server.close();
    }
  }, 30000);

  test('should respond to config endpoint when UI is enabled', async () => {
    const logger = createConsoleLogger('fastify-server', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Fastify Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(testConfig, logger);
    try {
      const response = await fetch(`http://localhost:${serverPort}/api/config`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('realm');
      expect(data).toHaveProperty('name');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('authMode', 'none');
    } finally {
      await server.close();
    }
  }, 30000);

  test('should shutdown gracefully', async () => {
    const logger = createConsoleLogger('fastify-server', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Fastify Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(testConfig, logger);
    try {
      // Test that server is still responding before shutdown
      const response = await fetch(`http://localhost:${serverPort}/health`);
      expect(response.status).toBe(200);
    } catch (error: any) {
      await server.close();
      throw error;
    }

    // Shutdown server
    await server.close();

    // Verify server is no longer responding
    try {
      await fetch(`http://localhost:${serverPort}/health`);
      // If fetch succeeds, server is still running (test should fail)
      expect(true).toBe(false);
    } catch (error) {
      // Expect connection error when server is shut down
      expect(error).toBeDefined();
    }
  }, 30000);
});
