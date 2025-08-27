import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { promises as fs } from 'fs';
import { startFastifyServer, createFastifyInstance } from '../src/server';
import { createConsoleLogger } from '../src/logger';
import { ServerConfig } from '../src/types';
import { createTestDirectory, getTestPort, testGlobalLogLevel } from './helpers/test-helper.js';
import { isPNGHeader, isICOHeader, hasReplacementCharacters, getFileStats } from './helpers/binary-test-helper';
import { createReaderWriterLock } from 'async-primitives';

/**
 * Fastify Static Binary Files Tests
 * 
 * Tests binary file serving functionality including:
 * - PNG icon file serving with correct binary data
 * - ICO favicon file serving with correct binary data
 * - Binary data integrity through fastify.inject
 * - Verification that response.rawPayload is used correctly
 */
describe('Fastify Static Binary Files', () => {
  let testBaseDir: string;
  let testPackagesDir: string;
  let testConfigDir: string;
  let testPublicDir: string;

  beforeEach(async (fn) => {
    // Create isolated test directory for each test
    testBaseDir = await createTestDirectory('fastify-static-binary', fn.task.name);
    testPackagesDir = path.join(testBaseDir, 'packages');
    testConfigDir = testBaseDir;
    testPublicDir = path.join(testBaseDir, 'public');
    
    // Create directories to avoid warnings
    await fs.mkdir(testPackagesDir, { recursive: true });
    await fs.mkdir(testPublicDir, { recursive: true });
    
    // Copy icon.png from src/ui/public to test directory
    const srcIconPath = path.join(process.cwd(), 'src', 'ui', 'public', 'icon.png');
    const testIconPath = path.join(testPublicDir, 'icon.png');
    await fs.copyFile(srcIconPath, testIconPath);
    
    // Copy favicon.ico from src/ui/public to test directory
    const srcFaviconPath = path.join(process.cwd(), 'src', 'ui', 'public', 'favicon.ico');
    const testFaviconPath = path.join(testPublicDir, 'favicon.ico');
    await fs.copyFile(srcFaviconPath, testFaviconPath);
  });

  //////////////////////////////////////////
  // Production Mode

  test('should serve /icon.png with correct binary data', async () => {
    const serverPort = 7001; // Fixed port for this test
    const logger = createConsoleLogger('fastify-static-binary', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Binary Server',
      logLevel: testGlobalLogLevel,
      noUi: false,
      authMode: 'none',
      trustedProxies: [],
      passwordStrengthCheck: false
    };

    const server = await startFastifyServer(testConfig, logger);
    try {
      const response = await fetch(`http://localhost:${serverPort}/icon.png`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      
      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Verify PNG header is intact
      expect(isPNGHeader(buffer)).toBe(true);
      
      // Verify no UTF-8 replacement characters
      expect(hasReplacementCharacters(buffer)).toBe(false);
      
      // Compare with original file
      const originalIconPath = path.join(process.cwd(), 'src', 'ui', 'public', 'icon.png');
      const originalStats = await getFileStats(originalIconPath);
      
      expect(buffer.length).toBe(originalStats.size);
      expect(buffer.slice(0, 16).toString('hex')).toBe(originalStats.firstBytes);
    } finally {
      await server.close();
    }
  }, 30000);

  test('should serve /favicon.ico with correct binary data', async () => {
    const serverPort = 7002; // Fixed port for this test
    const logger = createConsoleLogger('fastify-static-binary', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Binary Server',
      logLevel: testGlobalLogLevel,
      noUi: false,
      authMode: 'none',
      trustedProxies: [],
      passwordStrengthCheck: false
    };

    const server = await startFastifyServer(testConfig, logger);
    try {
      const response = await fetch(`http://localhost:${serverPort}/favicon.ico`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/x-icon');
      
      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Verify ICO header is intact
      expect(isICOHeader(buffer)).toBe(true);
      
      // Verify no UTF-8 replacement characters
      expect(hasReplacementCharacters(buffer)).toBe(false);
      
      // Compare with original file
      const originalFaviconPath = path.join(process.cwd(), 'src', 'ui', 'public', 'favicon.ico');
      const originalStats = await getFileStats(originalFaviconPath);
      
      expect(buffer.length).toBe(originalStats.size);
    } finally {
      await server.close();
    }
  }, 30000);

  //////////////////////////////////////////
  // Development Mode (inject)

  test('should handle binary data through fastify.inject', async () => {
    const serverPort = 7003; // Fixed port for this test
    const logger = createConsoleLogger('fastify-static-binary', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Inject Server',
      logLevel: testGlobalLogLevel,
      noUi: false,
      authMode: 'none',
      trustedProxies: [],
      passwordStrengthCheck: false
    };

    const locker = createReaderWriterLock();
    const fastifyInstance = await createFastifyInstance(testConfig, logger, locker);
    try {
      // Test fastify.inject for /icon.png
      const response = await fastifyInstance.inject({
        method: 'GET',
        url: '/icon.png'
      });
      
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      
      // Verify rawPayload is Buffer
      expect(Buffer.isBuffer(response.rawPayload)).toBe(true);
      
      // Verify PNG header in rawPayload
      expect(isPNGHeader(response.rawPayload)).toBe(true);
      
      // Verify no corruption in rawPayload
      expect(hasReplacementCharacters(response.rawPayload)).toBe(false);
      
      // Verify payload vs rawPayload types
      expect(typeof response.payload).toBe('string');
      expect(Buffer.isBuffer(response.rawPayload)).toBe(true);
      // For Fastify, the payload string should match rawPayload when converted properly
      // This indicates that the server is handling binary data correctly
    } finally {
      const handler = await locker.writeLock();
      try {
        await fastifyInstance.close();
      } finally {
        handler.release();
      }
    }
  }, 30000);

  test('should detect corruption in payload vs rawPayload', async () => {
    const serverPort = 7004; // Fixed port for this test
    const logger = createConsoleLogger('fastify-static-binary', testGlobalLogLevel);
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: 'Test Corruption Server',
      logLevel: testGlobalLogLevel,
      noUi: false,
      authMode: 'none',
      trustedProxies: [],
      passwordStrengthCheck: false
    };

    const locker = createReaderWriterLock();
    const fastifyInstance = await createFastifyInstance(testConfig, logger, locker);
    try {
      const response = await fastifyInstance.inject({
        method: 'GET',
        url: '/icon.png'
      });
      
      // Convert payload (string) back to Buffer to check for corruption
      const payloadAsBuffer = Buffer.from(response.payload, 'utf8');
      
      // The payload string should have replacement characters due to binary->string conversion
      expect(hasReplacementCharacters(payloadAsBuffer)).toBe(true);
      
      // But rawPayload should be clean
      expect(hasReplacementCharacters(response.rawPayload)).toBe(false);
      
      // rawPayload should have valid PNG header
      expect(isPNGHeader(response.rawPayload)).toBe(true);
      
      // payload converted to buffer should NOT have valid PNG header (corrupted)
      expect(isPNGHeader(payloadAsBuffer)).toBe(false);
    } finally {
      const handler = await locker.writeLock();
      try {
        await fastifyInstance.close();
      } finally {
        await handler.release();
      }
    }
  }, 30000);
});
