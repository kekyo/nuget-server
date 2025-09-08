// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * E2E test for missing package fallback behavior
 * Tests that empty-array mode allows successful dotnet restore with multiple sources
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

describe('E2E: Missing Package Fallback with empty-array mode', () => {
  let server: any;
  let testBaseDir: string;
  let serverPort: number;
  let projectDir: string;
  let logger: any;

  beforeEach(async (fn) => {
    // Create test directory
    testBaseDir = await createTestDirectory(
      'e2e-missing-package-fallback',
      fn.task.name
    );
    const testPackagesDir = path.join(testBaseDir, 'packages');
    projectDir = path.join(testBaseDir, 'TestProject');

    // Create packages directory
    await fs.mkdir(testPackagesDir, { recursive: true });

    // Generate unique port
    serverPort = getTestPort(15000);

    logger = createConsoleLogger('e2e-missing-package', testGlobalLogLevel);

    // Start server with empty-array mode (default)
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testBaseDir,
      realm: 'E2E Test Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
      missingPackageResponse: 'empty-array', // Explicitly set to empty-array mode
    };

    logger.info(`Starting server with empty-array mode on port ${serverPort}`);
    server = await startFastifyServer(testConfig, logger);

    // Wait for server to be ready
    await waitForServerReady(serverPort, 'none', 30, 500);
    logger.info('Server ready for E2E test');

    // Clear NuGet cache to ensure clean test
    await clearNuGetCache(logger);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  test('should successfully restore packages from nuget.org when local server returns empty array', async () => {
    // Create a test .NET project with Newtonsoft.Json package
    await createTestProject(projectDir, 'Newtonsoft.Json', '13.0.3');

    // Create NuGet.config with both local server and nuget.org as sources
    // Local server is added first to ensure it's queried first
    const nugetConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="local-test" value="http://localhost:${serverPort}/v3/index.json" allowInsecureConnections="true" />
    <add key="nuget-org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>`;

    const nugetConfigPath = path.join(projectDir, 'NuGet.config');
    await fs.writeFile(nugetConfigPath, nugetConfigContent);

    // Run dotnet restore 10 times to ensure stability
    logger.info('Starting 10 restore iterations to verify stability...');

    for (let i = 1; i <= 10; i++) {
      logger.info(`Running restore iteration ${i}/10`);

      // Clear obj and bin directories before each restore to ensure clean state
      // (except for the first iteration)
      if (i > 1) {
        const objDir = path.join(projectDir, 'obj');
        const binDir = path.join(projectDir, 'bin');

        try {
          await fs.rm(objDir, { recursive: true, force: true });
          await fs.rm(binDir, { recursive: true, force: true });
        } catch (error) {
          // Directories might not exist, ignore errors
        }
      }

      // Run dotnet restore
      const result = await runDotNetRestore(logger, projectDir);

      // Verify restore was successful for each iteration
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);

      // Verify the package was actually restored from nuget.org
      const packageRestored = await verifyPackageRestored(
        projectDir,
        'Newtonsoft.Json',
        '13.0.3'
      );
      expect(packageRestored).toBe(true);

      // Verify no 404 errors in the output
      expect(result.stderr).not.toContain('404');
      expect(result.stderr).not.toContain('NU1301'); // NuGet error code for "Unable to load the service index"

      logger.info(`Restore iteration ${i}/10 completed successfully`);
    }

    logger.info('All 10 restore iterations completed successfully');
  }, 180000); // 180 second timeout for 10 restore operations

  test('should fail restore when server is in not-found mode', async () => {
    // Close the current server
    await server.close();

    // Start a new server with not-found mode
    logger = createConsoleLogger(
      'e2e-missing-package-notfound',
      testGlobalLogLevel
    );

    const testPackagesDir = path.join(testBaseDir, 'packages');
    const testConfig: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testBaseDir,
      realm: 'E2E Test Server - Not Found Mode',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      passwordStrengthCheck: false,
      missingPackageResponse: 'not-found', // Set to not-found mode
    };

    logger.info(`Starting server with not-found mode on port ${serverPort}`);
    server = await startFastifyServer(testConfig, logger);
    await waitForServerReady(serverPort, 'none', 30, 500);

    // Create a new test project
    const projectDir2 = path.join(testBaseDir, 'TestProject2');
    await createTestProject(projectDir2, 'Newtonsoft.Json', '13.0.3');

    // Add only the local server as source (no nuget.org)
    await addNuGetSource(projectDir2, `http://localhost:${serverPort}`);

    // Run dotnet restore - should fail since package doesn't exist locally
    const result = await runDotNetRestore(logger, projectDir2);

    // Verify restore failed
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);

    // Should contain error messages about not finding the package
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/NU1101|Unable to find package|404/i);
  }, 60000);
});
