/**
 * dotnet restore V3 API Integration Tests
 */

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { delay } from 'async-primitives';
import { startFastifyServer } from '../src/server.js';
import { createConsoleLogger } from '../src/logger.js';
import { Logger, ServerConfig } from '../src/types.js';
import { createTestDirectory, getTestPort, testGlobalLogLevel } from './helpers/test-helper.js';
import {
  createTestProject,
  addNuGetSource,
  addNuGetSourceWithAuth,
  runDotNetRestore,
  verifyPackageRestored,
  clearNuGetCache
} from './helpers/dotnet.js';

describe('dotnet restore V3 API Integration Tests', () => {
  // Helper to start server for a specific test
  const startTestServer = async (authMode: 'none' | 'publish' | 'full', testName: string) => {
    const testBaseDir = await createTestDirectory(`dotnet-v3-integration-${authMode}`, testName);
    const testConfigDir = testBaseDir;
    const testPackagesDir = path.join(testBaseDir, 'packages');
    const logger = createConsoleLogger('dotnet-v3-integration', testGlobalLogLevel);
    
    // Create packages directory
    await fs.mkdir(testPackagesDir, { recursive: true });
    
    // Setup test packages
    await setupTestPackages(logger, testPackagesDir);
    
    // Create test users if needed
    if (authMode !== 'none') {
      await createTestUsers(testConfigDir);
    }
    
    // Generate unique port
    const serverPort = getTestPort(authMode === 'none' ? 9000 : authMode === 'publish' ? 9100 : 9200);
    
    // Start server
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: `Test Dotnet V3 Server - ${authMode}`,
      logLevel: testGlobalLogLevel,
      noUi: false,
      authMode
    };

    logger.info(`Starting server with authMode=${authMode} on port ${serverPort}`);
    const server = await startFastifyServer(testConfig, logger);
    
    // Wait for metadata service to initialize
    await delay(5000);
    //await new Promise(resolve => setTimeout(resolve, 5000));
    
    return { server, testBaseDir, testConfigDir, testPackagesDir, serverPort, logger };
  };

  // Create test users for authentication tests
  const createTestUsers = async (testConfigDir: string) => {
    const testUsers = [
      {
        id: "test-admin-dotnet",
        username: "testadmindotnet",
        passwordHash: "pq1IBF6VQHli4o6e3rSbU1S8gDw=", // password: adminpass (SHA1)
        salt: "test-salt-admin-dotnet",
        apiKeyHash: "ilM/nZT2xLm3TDFrC60Lm3yuYhQ=", // api key: admin-api-key-123 (SHA1)
        apiKeySalt: "test-api-salt-admin-dotnet",
        role: "admin",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z"
      }
    ];
    
    await fs.writeFile(
      path.join(testConfigDir, 'users.json'),
      JSON.stringify(testUsers, null, 2)
    );
  };

  // Extract nuspec from nupkg
  const extractNuspecFromNupkg = async (nupkgPath: string, targetDir: string, packageId: string): Promise<void> => {
    const zip = new AdmZip(nupkgPath);
    const entries = zip.getEntries();
    
    for (const entry of entries) {
      if (entry.entryName.endsWith('.nuspec') && !entry.entryName.includes('/')) {
        const nuspecContent = entry.getData();
        const normalizedFileName = `${packageId}.nuspec`;
        const targetPath = path.join(targetDir, normalizedFileName);
        await fs.writeFile(targetPath, nuspecContent);
        return;
      }
    }
    
    throw new Error(`No nuspec file found in ${nupkgPath}`);
  };

  // Setup packages from fixtures
  const setupTestPackages = async (logger: Logger, testPackagesDir: string) => {
    const fixturesDir = path.join(process.cwd(), 'tests/fixtures/packages');
    
    try {
      const files = await fs.readdir(fixturesDir);
      
      for (const file of files) {
        if (file.endsWith('.nupkg')) {
          const match = file.match(/^(.+?)\.(\d+\.\d+\.\d+)\.nupkg$/);
          if (match) {
            const [, packageId, version] = match;
            
            const packageDir = path.join(testPackagesDir, packageId, version);
            await fs.mkdir(packageDir, { recursive: true });
            
            const sourcePath = path.join(fixturesDir, file);
            const targetPath = path.join(packageDir, file);
            
            try {
              await fs.copyFile(sourcePath, targetPath);
              await extractNuspecFromNupkg(sourcePath, packageDir, packageId);
              //logger.debug(`Copied package: ${packageId} ${version}`);
            } catch (error) {
              logger.error(`Failed to copy ${packageId} ${version}: ${error}`);
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to read fixtures directory: ${error}`);
    }
  };

  // ===== authMode=none tests =====
  
  test('[authMode=none] should perform basic dotnet restore successfully', async () => {
    const { server, testBaseDir, serverPort, logger } = await startTestServer('none', 'basic-dotnet-restore');
    
    try {
      const packageId = 'FlashCap';
      const packageVersion = '1.10.0';
      const dotnetDir = path.join(testBaseDir, 'dotnet');
      
      await createTestProject(dotnetDir, packageId, packageVersion);
      await addNuGetSource(dotnetDir, `http://localhost:${serverPort}`);
      
      const restoreResult = await runDotNetRestore(dotnetDir);
      
      if (!restoreResult.success) {
        logger.info(`Restore stdout: ${restoreResult.stdout}`);
        logger.info(`Restore stderr: ${restoreResult.stderr}`);
      }
      
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.exitCode).toBe(0);
      
      const packageRestored = await verifyPackageRestored(dotnetDir, packageId, packageVersion);
      expect(packageRestored).toBe(true);
    } finally {
      await server.close();
    }
  }, 60000);

  test('[authMode=none] should restore FlashCap version 1.11.0', async () => {
    const { server, testBaseDir, serverPort, logger } = await startTestServer('none', 'restore-flashcap-1.11.0');
    
    try {
      // Clear NuGet cache to ensure test isolation
      await clearNuGetCache();

      const packageId = 'FlashCap';
      const version = '1.11.0';
      const dotnetDir = path.join(testBaseDir, 'dotnet-test2');
      
      await createTestProject(dotnetDir, packageId, version);
      await addNuGetSource(dotnetDir, `http://localhost:${serverPort}`);
      
      const restoreResult = await runDotNetRestore(dotnetDir);
      
      if (!restoreResult.success) {
        logger.info(`Restore failed for ${packageId} ${version}:`);
        logger.info(`stdout: ${restoreResult.stdout}`);
        logger.info(`stderr: ${restoreResult.stderr}`);
      }
      
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.exitCode).toBe(0);
      
      const packageRestored = await verifyPackageRestored(dotnetDir, packageId, version);
      expect(packageRestored).toBe(true);
    } finally {
      await server.close();
    }
  }, 60000);

  test('[authMode=none] should restore FlashCap version 1.10.0', async () => {
    const { server, testBaseDir, serverPort, logger } = await startTestServer('none', 'restore-flashcap-1.10.0');
    
    try {
      const packageId = 'FlashCap';
      const version = '1.10.0';
      const dotnetDir = path.join(testBaseDir, 'dotnet-v2');
      
      await createTestProject(dotnetDir, packageId, version);
      await addNuGetSource(dotnetDir, `http://localhost:${serverPort}`);
      
      const restoreResult = await runDotNetRestore(dotnetDir);
      
      if (!restoreResult.success) {
        logger.info(`Restore failed for ${packageId} ${version}:`);
        logger.info(`stdout: ${restoreResult.stdout}`);
        logger.info(`stderr: ${restoreResult.stderr}`);
      }
      
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.exitCode).toBe(0);
      
      const packageRestored = await verifyPackageRestored(dotnetDir, packageId, version);
      expect(packageRestored).toBe(true);
    } finally {
      await server.close();
    }
  }, 60000);

  test('[authMode=none] should work after package upload (using existing fixture)', async () => {
    const { server, testBaseDir, serverPort, testPackagesDir, logger } = await startTestServer('none', 'work-after-upload');
    
    try {
      // Debug: Check if GitReader package exists
      const gitReaderPath = path.join(testPackagesDir, 'GitReader', '1.15.0');
      logger.info(`Checking GitReader package at: ${gitReaderPath}`);
      const gitReaderExists = await fs.pathExists(gitReaderPath);
      logger.info(`GitReader package exists: ${gitReaderExists}`);
      if (gitReaderExists) {
        const files = await fs.readdir(gitReaderPath);
        logger.info(`GitReader files: ${files.join(', ')}`);
      }
      
      // Check search API response
      const searchResponse = await fetch(`http://localhost:${serverPort}/v3/search?q=GitReader`);
      const searchResult = await searchResponse.json();
      logger.info(`Search for GitReader: totalHits=${searchResult.totalHits}, packages=${searchResult.data.map((p: any) => p.id).join(', ')}`);
      
      // Check registration API
      const regResponse = await fetch(`http://localhost:${serverPort}/v3/registrations/gitreader/index.json`);
      logger.info(`Registration API for GitReader: status=${regResponse.status}`);
      if (regResponse.status === 200) {
        const regData = await regResponse.json();
        logger.info(`Registration data: ${JSON.stringify(regData).substring(0, 200)}`);
      }

      // Since this is authMode=none, we don't actually test upload
      // Just verify restore works with existing fixtures
      const packageId = 'GitReader';
      const packageVersion = '1.15.0';
      const dotnetDir = path.join(testBaseDir, 'dotnet');
      
      await createTestProject(dotnetDir, packageId, packageVersion);
      await addNuGetSource(dotnetDir, `http://localhost:${serverPort}`);
      
      const restoreResult = await runDotNetRestore(dotnetDir);
      
      if (!restoreResult.success) {
        logger.info(`Restore stdout: ${restoreResult.stdout}`);
        logger.info(`Restore stderr: ${restoreResult.stderr}`);
      }
      
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.exitCode).toBe(0);
      
      const packageRestored = await verifyPackageRestored(dotnetDir, packageId, packageVersion);
      expect(packageRestored).toBe(true);
    } finally {
      await server.close();
    }
  }, 90000);

  // ===== authMode=publish tests =====
  
  test('[authMode=publish] should allow package retrieval without authentication', async () => {
    const { server, testBaseDir, serverPort, logger } = await startTestServer('publish', 'allow-retrieval-no-auth');
    
    try {
      const packageId = 'FlashCap';
      const packageVersion = '1.10.0';
      const dotnetDir = path.join(testBaseDir, 'dotnet');
      
      await createTestProject(dotnetDir, packageId, packageVersion);
      await addNuGetSource(dotnetDir, `http://localhost:${serverPort}`);
      
      const restoreResult = await runDotNetRestore(dotnetDir);
      
      if (!restoreResult.success) {
        logger.info(`Restore stdout: ${restoreResult.stdout}`);
        logger.info(`Restore stderr: ${restoreResult.stderr}`);
      }
      
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.exitCode).toBe(0);
      
      const packageRestored = await verifyPackageRestored(dotnetDir, packageId, packageVersion);
      expect(packageRestored).toBe(true);
    } finally {
      await server.close();
    }
  }, 60000);

  test('[authMode=publish] should verify that publish API requires authentication', async () => {
    const { server, serverPort, logger } = await startTestServer('publish', 'verify-publish-requires-auth');
    
    try {
      // Test that publish endpoint requires authentication
      const publishResponse = await fetch(`http://localhost:${serverPort}/api/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: Buffer.from('dummy-package-content')
      });
      
      expect(publishResponse.status).toBe(401);
      
      // But V3 API should still work without auth
      const serviceIndexResponse = await fetch(`http://localhost:${serverPort}/v3/index.json`);
      expect(serviceIndexResponse.status).toBe(200);
    } finally {
      await server.close();
    }
  }, 60000);

  // ===== authMode=full tests =====
  
  test('[authMode=full] should fail dotnet restore without authentication', async () => {
    const { server, testBaseDir, serverPort, logger } = await startTestServer('full', 'fail-restore-no-auth');
    
    try {
      // Clear NuGet cache to ensure test isolation
      await clearNuGetCache();
      
      // Test V3 API directly first
      const serviceIndexResponse = await fetch(`http://localhost:${serverPort}/v3/index.json`);
      expect(serviceIndexResponse.status).toBe(401);
      
      const packageId = 'FlashCap';
      const packageVersion = '1.10.0';
      const dotnetDir = path.join(testBaseDir, 'dotnet');
      
      await createTestProject(dotnetDir, packageId, packageVersion);
      await addNuGetSource(dotnetDir, `http://localhost:${serverPort}`);
      
      const restoreResult = await runDotNetRestore(dotnetDir);
      
      // Should fail without authentication
      expect(restoreResult.success).toBe(false);
      expect(restoreResult.stdout).toContain('401');
      
      // V3 API should still require auth after restore attempt
      const serviceIndexResponse2 = await fetch(`http://localhost:${serverPort}/v3/index.json`);
      expect(serviceIndexResponse2.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 60000);

  test('[authMode=full] should succeed with authentication in NuGet.config', async () => {
    const { server, testBaseDir, serverPort, logger} = await startTestServer('full', 'succeed-with-auth');
    
    try {
      // Clear NuGet cache to ensure test isolation
      await clearNuGetCache();

      const packageId = 'FlashCap';
      const packageVersion = '1.10.0';
      const dotnetDir = path.join(testBaseDir, 'dotnet');
      
      await createTestProject(dotnetDir, packageId, packageVersion);
      
      // Use API key authentication
      await addNuGetSourceWithAuth(
        dotnetDir, 
        `http://localhost:${serverPort}`, 
        'testadmindotnet',
        'admin-api-key-123'
      );
      
      const restoreResult = await runDotNetRestore(dotnetDir);
      
      if (!restoreResult.success) {
        logger.info(`Restore stdout: ${restoreResult.stdout}`);
        logger.info(`Restore stderr: ${restoreResult.stderr}`);
      }
      
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.exitCode).toBe(0);
      
      const packageRestored = await verifyPackageRestored(dotnetDir, packageId, packageVersion);
      expect(packageRestored).toBe(true);
    } finally {
      await server.close();
    }
  }, 60000);
});