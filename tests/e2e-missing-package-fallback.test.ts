// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * E2E test for missing package fallback behavior
 * Tests that empty-array mode allows successful dotnet restore with multiple local sources
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'fs';
import { startFastifyServer } from '../src/server.js';
import { createConsoleLogger } from '../src/logger.js';
import { ServerConfig } from '../src/types.js';
import {
  createTestDirectory,
  getTestPort,
  testGlobalLogLevel,
  waitForServerReady,
} from './helpers/test-helper.js';
import {
  createTestProject,
  addNuGetSource,
  runDotNetRestore,
  verifyPackageRestored,
  clearNuGetCache,
} from './helpers/dotnet.js';
import { setupPackageStorage } from './helpers/package.js';

describe('E2E: Missing Package Fallback with empty-array mode', () => {
  let primaryServer: any;
  let fallbackServer: any;
  let testBaseDir: string;
  let primaryServerPort: number;
  let fallbackServerPort: number;
  let projectDir: string;
  let logger: any;

  const clearProjectRestoreState = async (
    targetProjectDir: string
  ): Promise<void> => {
    const pathsToRemove = [
      path.join(targetProjectDir, 'obj'),
      path.join(targetProjectDir, 'bin'),
      path.join(targetProjectDir, '.nuget', 'packages'),
      path.join(targetProjectDir, '.nuget', 'http-cache'),
    ];

    for (const targetPath of pathsToRemove) {
      await fs.rm(targetPath, { recursive: true, force: true });
    }
  };

  const logRestoreFailure = async (
    targetLogger: any,
    targetProjectDir: string,
    iterationLabel: string,
    result: {
      exitCode?: number;
      stdout: string;
      stderr: string;
    }
  ): Promise<void> => {
    targetLogger.error(
      `Restore failed during ${iterationLabel} with exit code: ${result.exitCode}`
    );
    targetLogger.info(`Restore stdout (${iterationLabel}): ${result.stdout}`);
    targetLogger.info(`Restore stderr (${iterationLabel}): ${result.stderr}`);

    try {
      const nugetConfig = await fs.readFile(
        path.join(targetProjectDir, 'NuGet.config'),
        'utf-8'
      );
      targetLogger.info(`NuGet.config (${iterationLabel}): ${nugetConfig}`);
    } catch (error) {
      targetLogger.warn(
        `Failed to read NuGet.config during ${iterationLabel}: ${error}`
      );
    }
  };

  beforeEach(async (fn) => {
    // Create test directory
    testBaseDir = await createTestDirectory(
      'e2e-missing-package-fallback',
      fn.task.name
    );
    const primaryPackagesDir = path.join(testBaseDir, 'primary-packages');
    const fallbackStorageDir = path.join(testBaseDir, 'fallback-storage');
    const fallbackPackagesDir = path.join(fallbackStorageDir, 'packages');
    projectDir = path.join(testBaseDir, 'TestProject');

    // Create packages directory
    await fs.mkdir(primaryPackagesDir, { recursive: true });
    await fs.mkdir(fallbackStorageDir, { recursive: true });
    await setupPackageStorage(fallbackStorageDir);

    // Generate unique port
    primaryServerPort = await getTestPort(15000);
    fallbackServerPort = await getTestPort(20000);

    logger = createConsoleLogger('e2e-missing-package', testGlobalLogLevel);

    // Start primary server with empty-array mode (default)
    const primaryConfig: ServerConfig = {
      port: primaryServerPort,
      packageDir: primaryPackagesDir,
      configDir: testBaseDir,
      realm: 'E2E Primary Test Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
      missingPackageResponse: 'empty-array', // Explicitly set to empty-array mode
    };

    logger.info(
      `Starting primary server with empty-array mode on port ${primaryServerPort}`
    );
    primaryServer = await startFastifyServer(primaryConfig, logger);

    const fallbackConfig: ServerConfig = {
      port: fallbackServerPort,
      packageDir: fallbackPackagesDir,
      configDir: testBaseDir,
      realm: 'E2E Fallback Test Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
      missingPackageResponse: 'not-found',
    };

    logger.info(
      `Starting fallback package server on port ${fallbackServerPort}`
    );
    fallbackServer = await startFastifyServer(fallbackConfig, logger);

    // Wait for servers to be ready
    await waitForServerReady(primaryServerPort, 'none', 30, 500);
    await waitForServerReady(fallbackServerPort, 'none', 30, 500);
    logger.info('Primary and fallback servers are ready for E2E test');

    // Clear NuGet cache to ensure clean test
    await clearNuGetCache(logger);
  });

  afterEach(async () => {
    if (primaryServer) {
      await primaryServer.close();
      primaryServer = null;
    }
    if (fallbackServer) {
      await fallbackServer.close();
      fallbackServer = null;
    }
  });

  test('should successfully restore packages from fallback source when primary server returns empty array', async () => {
    // Create a test .NET project with a package available only on the fallback server
    await createTestProject(projectDir, 'FlashCap', '1.10.0');

    // Create NuGet.config with primary and fallback local sources
    // Primary server is added first to ensure fallback behavior is exercised
    const nugetConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="primary-test" value="http://localhost:${primaryServerPort}/v3/index.json" allowInsecureConnections="true" />
    <add key="fallback-test" value="http://localhost:${fallbackServerPort}/v3/index.json" allowInsecureConnections="true" />
  </packageSources>
</configuration>`;

    const nugetConfigPath = path.join(projectDir, 'NuGet.config');
    await fs.writeFile(nugetConfigPath, nugetConfigContent);

    // Run dotnet restore 10 times to ensure stability
    logger.info(
      'Starting 10 restore iterations to verify fallback stability...'
    );

    for (let i = 1; i <= 10; i++) {
      logger.info(`Running restore iteration ${i}/10`);

      // Clear project outputs and isolated NuGet caches before each restore
      await clearProjectRestoreState(projectDir);

      // Run dotnet restore
      const result = await runDotNetRestore(logger, projectDir);

      if (!result.success) {
        await logRestoreFailure(
          logger,
          projectDir,
          `iteration ${i}/10`,
          result
        );
      }

      // Verify restore was successful for each iteration
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);

      // Verify the package was restored from the fallback source
      const packageRestored = await verifyPackageRestored(
        projectDir,
        'FlashCap',
        '1.10.0'
      );
      expect(packageRestored).toBe(true);
      expect(result.stdout).toContain(
        `from http://localhost:${fallbackServerPort}/v3/index.json`
      );

      // Verify no service index or 404 errors in the output
      expect(result.stdout).not.toContain('404');
      expect(result.stderr).not.toContain('404');
      expect(result.stdout).not.toContain('NU1301');
      expect(result.stderr).not.toContain('NU1301'); // NuGet error code for "Unable to load the service index"

      logger.info(`Restore iteration ${i}/10 completed successfully`);
    }

    logger.info('All 10 restore iterations completed successfully');
  }, 180000); // 180 second timeout for 10 restore operations

  test('should fail restore when server is in not-found mode', async () => {
    // Close the current server
    await primaryServer.close();
    primaryServer = null;

    // Start a new server with not-found mode
    logger = createConsoleLogger(
      'e2e-missing-package-notfound',
      testGlobalLogLevel
    );

    const primaryPackagesDir = path.join(testBaseDir, 'primary-packages');
    const testConfig: ServerConfig = {
      port: primaryServerPort,
      packageDir: primaryPackagesDir,
      configDir: testBaseDir,
      realm: 'E2E Test Server - Not Found Mode',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
      missingPackageResponse: 'not-found', // Set to not-found mode
    };

    logger.info(
      `Starting primary server with not-found mode on port ${primaryServerPort}`
    );
    primaryServer = await startFastifyServer(testConfig, logger);
    await waitForServerReady(primaryServerPort, 'none', 30, 500);

    // Create a new test project
    const projectDir2 = path.join(testBaseDir, 'TestProject2');
    await createTestProject(projectDir2, 'FlashCap', '1.10.0');

    // Add only the primary server as source (no fallback source)
    await addNuGetSource(projectDir2, `http://localhost:${primaryServerPort}`);
    await clearProjectRestoreState(projectDir2);

    // Run dotnet restore - should fail since package doesn't exist locally
    const result = await runDotNetRestore(logger, projectDir2);

    if (result.success) {
      logger.error('Restore unexpectedly succeeded in not-found mode');
      logger.info(`Restore stdout (not-found mode): ${result.stdout}`);
      logger.info(`Restore stderr (not-found mode): ${result.stderr}`);
    }

    // Verify restore failed
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);

    // Should contain error messages about not finding the package
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/NU1101|Unable to find package|404/i);
  }, 60000);
});
