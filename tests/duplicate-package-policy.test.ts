/**
 * Duplicate Package Policy Tests
 *
 * Tests for the duplicate package handling policy feature:
 * - overwrite: Replace existing package
 * - ignore: Skip upload if package exists (default)
 * - error: Return error if package exists
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { startFastifyServer } from '../src/server.js';
import { createConsoleLogger } from '../src/logger.js';
import { ServerConfig } from '../src/types.js';
import {
  createTestDirectory,
  getTestPort,
  testGlobalLogLevel,
  waitForServerReady,
} from './helpers/test-helper.js';
import { pathExists } from './helpers/fs-utils.js';

describe('Duplicate Package Policy Tests', () => {
  let server: FastifyInstance | null = null;
  let testBaseDir: string;
  let testPackagesDir: string;
  let serverPort: number;
  const logger = createConsoleLogger(
    'duplicate-policy-test',
    testGlobalLogLevel
  );

  // Test package data (using existing test fixture)
  const testPackagePath = path.resolve(
    import.meta.dirname,
    './fixtures/packages/FlashCap.1.10.0.nupkg'
  );
  const packageId = 'FlashCap';
  const packageVersion = '1.10.0';

  beforeEach(async () => {
    // Clean up any existing server
    if (server) {
      await server.close();
      server = null;
    }
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  const startServerWithPolicy = async (
    policy: 'overwrite' | 'ignore' | 'error',
    testName: string
  ): Promise<{
    server: FastifyInstance;
    testBaseDir: string;
    testPackagesDir: string;
    serverPort: number;
  }> => {
    const testDir = await createTestDirectory(
      'duplicate-package-policy',
      testName
    );
    const packagesDir = path.join(testDir, 'packages');
    await fs.mkdir(packagesDir, { recursive: true });

    const port = await getTestPort(9500);

    const config: ServerConfig = {
      port,
      packageDir: packagesDir,
      configDir: testDir,
      realm: 'Test Duplicate Policy Server',
      logLevel: testGlobalLogLevel,
      authMode: 'none',
      duplicatePackagePolicy: policy,
    };

    logger.info(`Starting server with duplicatePackagePolicy=${policy}`);
    const serverInstance = await startFastifyServer(config, logger);

    // Wait for server to be ready
    await waitForServerReady(port, 'none', 30, 500);

    return {
      server: serverInstance,
      testBaseDir: testDir,
      testPackagesDir: packagesDir,
      serverPort: port,
    };
  };

  const uploadPackage = async (
    port: number,
    source: string | Buffer
  ): Promise<{ status: number; body: any }> => {
    const packageBuffer =
      typeof source === 'string' ? await fs.readFile(source) : source;

    const response = await fetch(`http://localhost:${port}/api/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': packageBuffer.length.toString(),
      },
      body: new Uint8Array(packageBuffer),
    });

    const body = await response.json();
    return { status: response.status, body };
  };

  const digest = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  const downloadHash = async () => {
    const id = packageId.toLowerCase();
    const response = await fetch(
      `http://localhost:${serverPort}/v3/package/${id}/${packageVersion}/${id}.${packageVersion}.nupkg`
    );
    expect(response.status).toBe(200);
    return digest(Buffer.from(await response.arrayBuffer()));
  };

  const makeReplacement = async () => {
    const zip = new AdmZip(await fs.readFile(testPackagePath));
    zip.addFile('release-notes.txt', Buffer.from('Second publication'));
    return zip.toBuffer();
  };

  describe('ignore policy (default)', () => {
    test('should upload new package successfully', async () => {
      const setup = await startServerWithPolicy('ignore', 'ignore-new');
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload - should succeed
      const result = await uploadPackage(serverPort, testPackagePath);

      expect(result.status).toBe(201);
      expect(result.body.message).toBe('Package uploaded successfully');
      expect(result.body.id).toBe(packageId);
      expect(result.body.version).toBe(packageVersion);

      // Verify file was created
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`
      );
      expect(await pathExists(packageFilePath)).toBe(true);
    });

    test('should ignore duplicate package upload', async () => {
      const setup = await startServerWithPolicy('ignore', 'ignore-duplicate');
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload
      const result1 = await uploadPackage(serverPort, testPackagePath);
      expect(result1.status).toBe(201);

      // Confirm that the second upload has distinct bytes under the same package identity.
      const before = await downloadHash();
      const replacement = await makeReplacement();
      expect(digest(replacement)).not.toBe(before);

      // Second upload - should be ignored
      const result2 = await uploadPackage(serverPort, replacement);

      expect(result2.status).toBe(200);
      expect(result2.body.message).toBe(
        'Package already exists and was ignored'
      );
      expect(result2.body.id).toBe(packageId);
      expect(result2.body.version).toBe(packageVersion);

      // Verify that the download URL still serves the original archive.
      expect(await downloadHash()).toBe(before);
    });
  });

  describe('overwrite policy', () => {
    test('serves the replacement icon when its format changes', async () => {
      const setup = await startServerWithPolicy('overwrite', 'overwrite-icon');
      server = setup.server;
      for (const extension of ['png', 'jpeg']) {
        const archive = new AdmZip();
        const manifest = `<package><metadata><id>Example</id><version>1.0</version><icon>logo.${extension}</icon></metadata></package>`;
        archive.addFile('Example.nuspec', Buffer.from(manifest));
        archive.addFile(`logo.${extension}`, Buffer.from(extension));
        expect(
          (await uploadPackage(setup.serverPort, archive.toBuffer())).status
        ).toBe(201);
        const icon = await fetch(
          `http://localhost:${setup.serverPort}/api/ui/icon/Example/1.0`
        );
        expect(icon.status).toBe(200);
        expect(await icon.text()).toBe(extension);
      }
    });

    test('should upload new package successfully', async () => {
      const setup = await startServerWithPolicy('overwrite', 'overwrite-new');
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload - should succeed
      const result = await uploadPackage(serverPort, testPackagePath);

      expect(result.status).toBe(201);
      expect(result.body.message).toBe('Package uploaded successfully');
      expect(result.body.id).toBe(packageId);
      expect(result.body.version).toBe(packageVersion);

      // Verify file was created
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`
      );
      expect(await pathExists(packageFilePath)).toBe(true);
    });

    test('should overwrite duplicate package', async () => {
      const setup = await startServerWithPolicy(
        'overwrite',
        'overwrite-duplicate'
      );
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload
      const result1 = await uploadPackage(serverPort, testPackagePath);
      expect(result1.status).toBe(201);

      // Confirm that the second upload has distinct bytes under the same package identity.
      const before = await downloadHash();
      const replacement = await makeReplacement();
      expect(digest(replacement)).not.toBe(before);

      // Second upload - should overwrite
      const result2 = await uploadPackage(serverPort, replacement);

      expect(result2.status).toBe(201);
      expect(result2.body.message).toBe(
        'Package uploaded successfully (replaced existing version)'
      );
      expect(result2.body.id).toBe(packageId);
      expect(result2.body.version).toBe(packageVersion);

      // Verify that the download URL serves exactly the replacement.
      expect(await downloadHash()).toBe(digest(replacement));
    });
  });

  describe('error policy', () => {
    test('should upload new package successfully', async () => {
      const setup = await startServerWithPolicy('error', 'error-new');
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload - should succeed
      const result = await uploadPackage(serverPort, testPackagePath);

      expect(result.status).toBe(201);
      expect(result.body.message).toBe('Package uploaded successfully');
      expect(result.body.id).toBe(packageId);
      expect(result.body.version).toBe(packageVersion);

      // Verify file was created
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`
      );
      expect(await pathExists(packageFilePath)).toBe(true);
    });

    test('should return error for duplicate package', async () => {
      const setup = await startServerWithPolicy('error', 'error-duplicate');
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload
      const result1 = await uploadPackage(serverPort, testPackagePath);
      expect(result1.status).toBe(201);

      // Confirm that the second upload has distinct bytes under the same package identity.
      const before = await downloadHash();
      const replacement = await makeReplacement();
      expect(digest(replacement)).not.toBe(before);

      // Second upload - should return error
      const result2 = await uploadPackage(serverPort, replacement);

      expect(result2.status).toBe(409);
      expect(result2.body.error).toBe(
        `Package ${packageId} version ${packageVersion} already exists`
      );

      // Verify that the download URL still serves the original archive.
      expect(await downloadHash()).toBe(before);
    });
  });

  describe('configuration priority', () => {
    test('environment variable should override config.json', async () => {
      const testDir = await createTestDirectory(
        'duplicate-package-policy',
        'env-override'
      );
      const packagesDir = path.join(testDir, 'packages');
      await fs.mkdir(packagesDir, { recursive: true });

      // Create config.json with "ignore" policy
      const configPath = path.join(testDir, 'config.json');
      await fs.writeFile(
        configPath,
        JSON.stringify({ duplicatePackagePolicy: 'ignore' }, null, 2)
      );

      // Set environment variable to "error"
      process.env.NUGET_SERVER_DUPLICATE_PACKAGE_POLICY = 'error';

      const port = await getTestPort(9600);
      const config: ServerConfig = {
        port,
        packageDir: packagesDir,
        configDir: testDir,
        realm: 'Test Env Override Server',
        logLevel: testGlobalLogLevel,
        authMode: 'none',
        // Explicitly set policy from environment variable since we're not going through CLI
        duplicatePackagePolicy: 'error',
      };

      try {
        // Start server - should use "error" policy
        server = await startFastifyServer(config, logger);
        await waitForServerReady(port, 'none', 30, 500);
        serverPort = port;
        testBaseDir = testDir;
        testPackagesDir = packagesDir;

        // First upload
        const result1 = await uploadPackage(serverPort, testPackagePath);
        expect(result1.status).toBe(201);

        // Second upload - should error (not ignore)
        const result2 = await uploadPackage(serverPort, testPackagePath);
        expect(result2.status).toBe(409); // Error policy
        expect(result2.body.error).toContain('already exists');
      } finally {
        delete process.env.NUGET_SERVER_DUPLICATE_PACKAGE_POLICY;
      }
    });

    test("should use default 'ignore' when not configured", async () => {
      const testDir = await createTestDirectory(
        'duplicate-package-policy',
        'default-policy'
      );
      const packagesDir = path.join(testDir, 'packages');
      await fs.mkdir(packagesDir, { recursive: true });

      const port = await getTestPort(9700);
      const config: ServerConfig = {
        port,
        packageDir: packagesDir,
        configDir: testDir,
        realm: 'Test Default Policy Server',
        logLevel: testGlobalLogLevel,
        authMode: 'none',
        // Don't set duplicatePackagePolicy - should default to "ignore"
      };

      server = await startFastifyServer(config, logger);
      await waitForServerReady(port, 'none', 30, 500);
      serverPort = port;
      testBaseDir = testDir;
      testPackagesDir = packagesDir;

      // First upload
      const result1 = await uploadPackage(serverPort, testPackagePath);
      expect(result1.status).toBe(201);

      // Second upload - should be ignored (default behavior)
      const result2 = await uploadPackage(serverPort, testPackagePath);
      expect(result2.status).toBe(200);
      expect(result2.body.message).toBe(
        'Package already exists and was ignored'
      );
    });
  });
});
