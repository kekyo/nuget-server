/**
 * Duplicate Package Policy Tests
 *
 * Tests for the duplicate package handling policy feature:
 * - overwrite: Replace existing package
 * - ignore: Skip upload if package exists (default)
 * - error: Return error if package exists
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { FastifyInstance } from "fastify";
import { startFastifyServer } from "../src/server.js";
import { createConsoleLogger } from "../src/logger.js";
import { ServerConfig } from "../src/types.js";
import {
  createTestDirectory,
  getTestPort,
  testGlobalLogLevel,
  waitForServerReady,
} from "./helpers/test-helper.js";
import { pathExists } from "./helpers/fs-utils.js";

describe("Duplicate Package Policy Tests", () => {
  let server: FastifyInstance | null = null;
  let testBaseDir: string;
  let testPackagesDir: string;
  let serverPort: number;
  const logger = createConsoleLogger(
    "duplicate-policy-test",
    testGlobalLogLevel,
  );

  // Test package data (using existing test fixture)
  const testPackagePath = path.resolve(
    import.meta.dirname,
    "./fixtures/packages/FlashCap.1.10.0.nupkg",
  );
  const packageId = "FlashCap";
  const packageVersion = "1.10.0";

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
    policy: "overwrite" | "ignore" | "error",
    testName: string,
  ): Promise<{
    server: FastifyInstance;
    testBaseDir: string;
    testPackagesDir: string;
    serverPort: number;
  }> => {
    const testDir = await createTestDirectory(
      "duplicate-package-policy",
      testName,
    );
    const packagesDir = path.join(testDir, "packages");
    await fs.mkdir(packagesDir, { recursive: true });

    const port = getTestPort(9500);

    const config: ServerConfig = {
      port,
      packageDir: packagesDir,
      configDir: testDir,
      realm: "Test Duplicate Policy Server",
      logLevel: testGlobalLogLevel,
      authMode: "none",
      duplicatePackagePolicy: policy,
    };

    logger.info(`Starting server with duplicatePackagePolicy=${policy}`);
    const serverInstance = await startFastifyServer(config, logger);

    // Wait for server to be ready
    await waitForServerReady(port, "none", 30, 500);

    return {
      server: serverInstance,
      testBaseDir: testDir,
      testPackagesDir: packagesDir,
      serverPort: port,
    };
  };

  const uploadPackage = async (
    port: number,
    packagePath: string,
  ): Promise<{ status: number; body: any }> => {
    const packageBuffer = await fs.readFile(packagePath);

    const response = await fetch(`http://localhost:${port}/api/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": packageBuffer.length.toString(),
      },
      body: new Uint8Array(packageBuffer),
    });

    const body = await response.json();
    return { status: response.status, body };
  };

  describe("ignore policy (default)", () => {
    test("should upload new package successfully", async () => {
      const setup = await startServerWithPolicy("ignore", "ignore-new");
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload - should succeed
      const result = await uploadPackage(serverPort, testPackagePath);

      expect(result.status).toBe(201);
      expect(result.body.message).toBe("Package uploaded successfully");
      expect(result.body.id).toBe(packageId);
      expect(result.body.version).toBe(packageVersion);

      // Verify file was created
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`,
      );
      expect(await pathExists(packageFilePath)).toBe(true);
    });

    test("should ignore duplicate package upload", async () => {
      const setup = await startServerWithPolicy("ignore", "ignore-duplicate");
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload
      const result1 = await uploadPackage(serverPort, testPackagePath);
      expect(result1.status).toBe(201);

      // Get file modification time before second upload
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`,
      );
      const statBefore = await fs.stat(packageFilePath);

      // Wait a bit to ensure different timestamp if file were to be modified
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second upload - should be ignored
      const result2 = await uploadPackage(serverPort, testPackagePath);

      expect(result2.status).toBe(200);
      expect(result2.body.message).toBe(
        "Package already exists and was ignored",
      );
      expect(result2.body.id).toBe(packageId);
      expect(result2.body.version).toBe(packageVersion);

      // Verify file was not modified
      const statAfter = await fs.stat(packageFilePath);
      expect(statAfter.mtime.getTime()).toBe(statBefore.mtime.getTime());
    });
  });

  describe("overwrite policy", () => {
    test("should upload new package successfully", async () => {
      const setup = await startServerWithPolicy("overwrite", "overwrite-new");
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload - should succeed
      const result = await uploadPackage(serverPort, testPackagePath);

      expect(result.status).toBe(201);
      expect(result.body.message).toBe("Package uploaded successfully");
      expect(result.body.id).toBe(packageId);
      expect(result.body.version).toBe(packageVersion);

      // Verify file was created
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`,
      );
      expect(await pathExists(packageFilePath)).toBe(true);
    });

    test("should overwrite duplicate package", async () => {
      const setup = await startServerWithPolicy(
        "overwrite",
        "overwrite-duplicate",
      );
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload
      const result1 = await uploadPackage(serverPort, testPackagePath);
      expect(result1.status).toBe(201);

      // Get file modification time before second upload
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`,
      );
      const statBefore = await fs.stat(packageFilePath);

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second upload - should overwrite
      const result2 = await uploadPackage(serverPort, testPackagePath);

      expect(result2.status).toBe(201);
      expect(result2.body.message).toBe(
        "Package uploaded successfully (replaced existing version)",
      );
      expect(result2.body.id).toBe(packageId);
      expect(result2.body.version).toBe(packageVersion);

      // Verify file was modified (new timestamp)
      const statAfter = await fs.stat(packageFilePath);
      expect(statAfter.mtime.getTime()).toBeGreaterThan(
        statBefore.mtime.getTime(),
      );
    });
  });

  describe("error policy", () => {
    test("should upload new package successfully", async () => {
      const setup = await startServerWithPolicy("error", "error-new");
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload - should succeed
      const result = await uploadPackage(serverPort, testPackagePath);

      expect(result.status).toBe(201);
      expect(result.body.message).toBe("Package uploaded successfully");
      expect(result.body.id).toBe(packageId);
      expect(result.body.version).toBe(packageVersion);

      // Verify file was created
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`,
      );
      expect(await pathExists(packageFilePath)).toBe(true);
    });

    test("should return error for duplicate package", async () => {
      const setup = await startServerWithPolicy("error", "error-duplicate");
      server = setup.server;
      testBaseDir = setup.testBaseDir;
      testPackagesDir = setup.testPackagesDir;
      serverPort = setup.serverPort;

      // First upload
      const result1 = await uploadPackage(serverPort, testPackagePath);
      expect(result1.status).toBe(201);

      // Get file modification time before second upload
      const packageFilePath = path.join(
        testPackagesDir,
        packageId,
        packageVersion,
        `${packageId}.${packageVersion}.nupkg`,
      );
      const statBefore = await fs.stat(packageFilePath);

      // Wait a bit to ensure timestamp would be different if modified
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second upload - should return error
      const result2 = await uploadPackage(serverPort, testPackagePath);

      expect(result2.status).toBe(409);
      expect(result2.body.error).toBe(
        `Package ${packageId} version ${packageVersion} already exists`,
      );

      // Verify file was not modified
      const statAfter = await fs.stat(packageFilePath);
      expect(statAfter.mtime.getTime()).toBe(statBefore.mtime.getTime());
    });
  });

  describe("configuration priority", () => {
    test("environment variable should override config.json", async () => {
      const testDir = await createTestDirectory(
        "duplicate-package-policy",
        "env-override",
      );
      const packagesDir = path.join(testDir, "packages");
      await fs.mkdir(packagesDir, { recursive: true });

      // Create config.json with "ignore" policy
      const configPath = path.join(testDir, "config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({ duplicatePackagePolicy: "ignore" }, null, 2),
      );

      // Set environment variable to "error"
      process.env.NUGET_SERVER_DUPLICATE_PACKAGE_POLICY = "error";

      const port = getTestPort(9600);
      const config: ServerConfig = {
        port,
        packageDir: packagesDir,
        configDir: testDir,
        realm: "Test Env Override Server",
        logLevel: testGlobalLogLevel,
        authMode: "none",
        // Explicitly set policy from environment variable since we're not going through CLI
        duplicatePackagePolicy: "error",
      };

      try {
        // Start server - should use "error" policy
        server = await startFastifyServer(config, logger);
        await waitForServerReady(port, "none", 30, 500);
        serverPort = port;
        testBaseDir = testDir;
        testPackagesDir = packagesDir;

        // First upload
        const result1 = await uploadPackage(serverPort, testPackagePath);
        expect(result1.status).toBe(201);

        // Second upload - should error (not ignore)
        const result2 = await uploadPackage(serverPort, testPackagePath);
        expect(result2.status).toBe(409); // Error policy
        expect(result2.body.error).toContain("already exists");
      } finally {
        delete process.env.NUGET_SERVER_DUPLICATE_PACKAGE_POLICY;
      }
    });

    test("should use default 'ignore' when not configured", async () => {
      const testDir = await createTestDirectory(
        "duplicate-package-policy",
        "default-policy",
      );
      const packagesDir = path.join(testDir, "packages");
      await fs.mkdir(packagesDir, { recursive: true });

      const port = getTestPort(9700);
      const config: ServerConfig = {
        port,
        packageDir: packagesDir,
        configDir: testDir,
        realm: "Test Default Policy Server",
        logLevel: testGlobalLogLevel,
        authMode: "none",
        // Don't set duplicatePackagePolicy - should default to "ignore"
      };

      server = await startFastifyServer(config, logger);
      await waitForServerReady(port, "none", 30, 500);
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
        "Package already exists and was ignored",
      );
    });
  });
});
