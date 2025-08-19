import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { startServer, ServerInstance } from './helpers/server.js';
import { createTestDirectory, testPackageUpload } from './helpers/package.js';
import { createConsoleLogger } from '../src/logger.js';

describe('Custom Package Directory', () => {
  let serverPort: number;
  let testBaseDir: string;
  let configDir: string;
  let customPackageDir: string;
  let serverInstance: ServerInstance | null = null;
  const logger = createConsoleLogger('CustomPackageDirTest');

  beforeEach(async (fn) => {
    serverPort = 3001 + Math.floor(Math.random() * 1000);
    
    // Create test directory using helper
    testBaseDir = await createTestDirectory(fn.task.name);
    configDir = testBaseDir;
    customPackageDir = path.join(testBaseDir, 'custom-packages');
    
    // Create custom package directory
    await fs.mkdir(customPackageDir, { recursive: true });
    
    logger.info(`Test directory: ${testBaseDir}`);
    logger.info(`Custom package directory: ${customPackageDir}`);
  });

  afterEach(async () => {
    // Stop server instance
    if (serverInstance) {
      await serverInstance.stop();
      serverInstance = null;
    }
    // Note: Test directories are preserved in test-results for debugging
  });

  it('should use custom package directory when specified', async () => {
    // Start server with custom package directory
    serverInstance = await startServer(
      serverPort, 
      testBaseDir, 
      (log) => logger.info(`[SERVER] ${log}`),
      customPackageDir,
      configDir
    );
    
    logger.info(`Server started on port ${serverPort} with custom package dir: ${customPackageDir}`);
    
    // Upload a test package
    const testPackagePath = path.join(process.cwd(), 'tests/fixtures/upload/NamingFormatter.2.4.0.nupkg');
    
    const result = await testPackageUpload(
      `http://localhost:${serverPort}/api/publish`,
      testPackagePath
    );

    expect(result.success).toBe(true);
    expect(result.response?.id).toBe('NamingFormatter');
    expect(result.response?.version).toBe('2.4.0');

    // Verify files were created in the custom directory
    const expectedNupkgPath = path.join(customPackageDir, 'NamingFormatter', '2.4.0', 'NamingFormatter.2.4.0.nupkg');
    const expectedNuspecPath = path.join(customPackageDir, 'NamingFormatter', '2.4.0', 'NamingFormatter.nuspec');
    
    await expect(fs.access(expectedNupkgPath)).resolves.toBeUndefined();
    await expect(fs.access(expectedNuspecPath)).resolves.toBeUndefined();
    
    logger.info('✅ Package files created in custom directory');
  });

  it('should not create default packages directory when custom directory is used', async () => {
    // Start server with custom package directory
    serverInstance = await startServer(
      serverPort, 
      testBaseDir, 
      (log) => logger.info(`[SERVER] ${log}`),
      customPackageDir,
      configDir
    );
    
    // Upload a test package
    const testPackagePath = path.join(process.cwd(), 'tests/fixtures/upload/NamingFormatter.2.4.0.nupkg');
    
    const result = await testPackageUpload(
      `http://localhost:${serverPort}/api/publish`,
      testPackagePath
    );

    expect(result.success).toBe(true);
    
    // Verify that the default packages directory was NOT created
    const defaultPackagesDir = path.join(testBaseDir, 'packages');
    
    try {
      await fs.access(defaultPackagesDir);
      // If we get here, the default directory exists when it shouldn't
      expect.fail('Default packages directory should not exist when custom directory is specified');
    } catch (error: any) {
      // This is expected - the default directory should not exist
      expect(error.code).toBe('ENOENT');
    }
    
    logger.info('✅ Default packages directory was not created');
  });

  it('should serve packages from custom directory', async () => {
    // Start server with custom package directory
    serverInstance = await startServer(
      serverPort, 
      testBaseDir, 
      (log) => logger.info(`[SERVER] ${log}`),
      customPackageDir,
      configDir
    );
    
    // Upload a test package
    const testPackagePath = path.join(process.cwd(), 'tests/fixtures/upload/NamingFormatter.2.4.0.nupkg');
    
    const uploadResult = await testPackageUpload(
      `http://localhost:${serverPort}/api/publish`,
      testPackagePath
    );

    expect(uploadResult.success).toBe(true);
    
    // Wait a moment for the server to process the package
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Test package versions endpoint
    const versionsResponse = await fetch(
      `http://localhost:${serverPort}/api/package/namingformatter/index.json`
    );
    
    expect(versionsResponse.ok).toBe(true);
    const versionsData = await versionsResponse.json();
    expect(versionsData.versions).toContain('2.4.0');
    
    // Test package download endpoint
    const downloadResponse = await fetch(
      `http://localhost:${serverPort}/api/package/namingformatter/2.4.0/namingformatter.2.4.0.nupkg`
    );
    
    expect(downloadResponse.ok).toBe(true);
    expect(downloadResponse.headers.get('content-type')).toBe('application/zip');
    
    const content = await downloadResponse.arrayBuffer();
    expect(content.byteLength).toBeGreaterThan(0);
    
    logger.info('✅ Package served successfully from custom directory');
  });

  it('should handle custom directory with absolute path', async () => {
    // Use absolute path for custom package directory
    const absoluteCustomDir = path.resolve(customPackageDir);
    
    // Start server with absolute custom package directory
    serverInstance = await startServer(
      serverPort, 
      testBaseDir, 
      (log) => logger.info(`[SERVER] ${log}`),
      absoluteCustomDir,
      configDir
    );
    
    logger.info(`Server started with absolute custom package dir: ${absoluteCustomDir}`);
    
    // Upload a test package
    const testPackagePath = path.join(process.cwd(), 'tests/fixtures/upload/NamingFormatter.2.4.0.nupkg');
    
    const result = await testPackageUpload(
      `http://localhost:${serverPort}/api/publish`,
      testPackagePath
    );

    expect(result.success).toBe(true);

    // Verify files were created in the absolute custom directory
    const expectedNupkgPath = path.join(absoluteCustomDir, 'NamingFormatter', '2.4.0', 'NamingFormatter.2.4.0.nupkg');
    const expectedNuspecPath = path.join(absoluteCustomDir, 'NamingFormatter', '2.4.0', 'NamingFormatter.nuspec');
    
    await expect(fs.access(expectedNupkgPath)).resolves.toBeUndefined();
    await expect(fs.access(expectedNuspecPath)).resolves.toBeUndefined();
    
    logger.info('✅ Package files created in absolute custom directory');
  });
});