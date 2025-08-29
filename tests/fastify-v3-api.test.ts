import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { startFastifyServer, FastifyServerInstance } from "../src/server";
import { createConsoleLogger } from "../src/logger";
import { ServerConfig } from "../src/types";
import {
  createTestDirectory,
  getTestPort,
  testGlobalLogLevel,
} from "./helpers/test-helper.js";

/**
 * Fastify NuGet V3 API Tests - Phase 3
 *
 * Tests Fastify server NuGet V3 API implementation including:
 * - V3 Service Index (/v3/index.json)
 * - V3 Package Search (/v3/search)
 * - V3 Package Download (/v3/package/{id}/{version}/{filename})
 * - V3 Registrations (/v3/registrations/{id}/index.json)
 * - Authentication requirements based on authMode
 * - Hybrid authentication middleware integration
 */
describe("Fastify NuGet V3 API - Phase 3 Tests", () => {
  let server: FastifyServerInstance | null = null;
  let testBaseDir: string;
  let testConfigDir: string;
  let testPackagesDir: string;
  let serverPort: number;

  // Create test users for authentication tests
  const createTestUsers = async () => {
    const testUsers = [
      {
        id: "test-admin-v3",
        username: "testadminv3",
        passwordHash: "eG4Xc4KveivmllFbTQDOnxEi1tc=", // password: "adminpass"
        salt: "test-salt-admin-v3",
        apiPasswordHash: "nXSuXLSSM+qifoV1U6tjCYK7b9c=", // apiPassword: "admin-api-key-123"
        apiPasswordSalt: "test-api-salt-admin-v3",
        role: "admin",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];

    await fs.writeFile(
      path.join(testConfigDir, "users.json"),
      JSON.stringify(testUsers, null, 2),
    );
  };

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  describe("V3 API with authMode=none (no authentication)", () => {
    beforeEach(async (fn) => {
      // Create isolated test directory for each test
      testBaseDir = await createTestDirectory(
        "fastify-v3-api-phase3-none",
        fn.task.name,
      );
      testConfigDir = testBaseDir;
      testPackagesDir = path.join(testBaseDir, "packages");

      // Create packages directory to avoid warnings
      await fs.mkdir(testPackagesDir, { recursive: true });

      // Generate unique port for each test
      serverPort = getTestPort(9000);

      // Create test users
      await createTestUsers();

      // Start server with no authentication
      const testConfig: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: "Test Fastify V3 Server - None",
        logLevel: testGlobalLogLevel,
        authMode: "none",
        passwordStrengthCheck: false,
      };

      const logger = createConsoleLogger("fastify-v3-api", testGlobalLogLevel);
      server = await startFastifyServer(testConfig, logger);
    });

    test("should return V3 service index without authentication", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/index.json`,
      );
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty(
        "@context",
        "https://api.nuget.org/v3/index.json",
      );
      expect(data).toHaveProperty("version");
      expect(Array.isArray(data.resources)).toBe(true);
      expect(data.resources.length).toBeGreaterThan(0);

      // Check for required resource types
      const resourceTypes = data.resources.map((r: any) => r["@type"]);
      expect(resourceTypes).toContain("RegistrationsBaseUrl");
      expect(resourceTypes).toContain("PackageBaseAddress/3.0.0");
      expect(resourceTypes).toContain("SearchQueryService");
    });

    test("should return empty search results without authentication", async () => {
      const response = await fetch(`http://localhost:${serverPort}/v3/search`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("totalHits", 0);
      expect(data).toHaveProperty("data");
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(0);
    });

    test("should return 404 for non-existent package download", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/package/nonexistent/1.0.0/nonexistent.1.0.0.nupkg`,
      );
      expect(response.status).toBe(404);
    });

    test("should return 404 for non-existent package registration", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/registrations/nonexistent/index.json`,
      );
      expect(response.status).toBe(404);
    });

    // PackageBaseAddress API tests
    test("should return 404 for non-existent package versions list", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/package/nonexistent/index.json`,
      );
      expect(response.status).toBe(404);
    });

    test("should handle case-insensitive package ID for versions list", async () => {
      // Note: This test would pass if packages exist, but in empty test environment it should return 404
      const response1 = await fetch(
        `http://localhost:${serverPort}/v3/package/FlashCap/index.json`,
      );
      const response2 = await fetch(
        `http://localhost:${serverPort}/v3/package/flashcap/index.json`,
      );

      // Both should return same status (404 in this case since no packages are setup)
      expect(response1.status).toBe(response2.status);
      expect(response1.status).toBe(404);
    });
  });

  describe("V3 API with authMode=publish (publish API requires authentication)", () => {
    beforeEach(async (fn) => {
      // Create isolated test directory for each test
      testBaseDir = await createTestDirectory(
        "fastify-v3-api-phase3-publish",
        fn.task.name,
      );
      testConfigDir = testBaseDir;
      testPackagesDir = path.join(testBaseDir, "packages");

      // Create packages directory to avoid warnings
      await fs.mkdir(testPackagesDir, { recursive: true });

      // Generate unique port for each test
      serverPort = getTestPort(9100);

      // Create test users
      await createTestUsers();

      // Start server with publish authentication
      const testConfig: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: "Test Fastify V3 Server - Publish",
        logLevel: testGlobalLogLevel,
        authMode: "publish",
        passwordStrengthCheck: false,
      };

      const logger = createConsoleLogger("fastify-v3-api", testGlobalLogLevel);
      server = await startFastifyServer(testConfig, logger);
    });

    test("should allow V3 API access without authentication", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/index.json`,
      );
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty(
        "@context",
        "https://api.nuget.org/v3/index.json",
      );
    });

    test("should allow package versions list access without authentication", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/package/nonexistent/index.json`,
      );
      // Should return 404 for non-existent package, not 401
      expect(response.status).toBe(404);
    });

    test("should allow package versions list access with invalid authentication", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/package/nonexistent/index.json`,
        {
          headers: {
            Authorization: "Basic aW52YWxpZDppbnZhbGlk", // invalid:invalid
          },
        },
      );
      // Should still return 404 for non-existent package, not 401
      expect(response.status).toBe(404);
    });
  });

  describe("V3 API with authMode=full (authentication required)", () => {
    beforeEach(async (fn) => {
      // Create isolated test directory for each test
      testBaseDir = await createTestDirectory(
        "fastify-v3-api-phase3-full",
        fn.task.name,
      );
      testConfigDir = testBaseDir;
      testPackagesDir = path.join(testBaseDir, "packages");

      // Create packages directory to avoid warnings
      await fs.mkdir(testPackagesDir, { recursive: true });

      // Generate unique port for each test
      serverPort = getTestPort(9200);

      // Create test users
      await createTestUsers();

      // Start server with full authentication
      const testConfig: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: "Test Fastify V3 Server - Full",
        logLevel: testGlobalLogLevel,
        authMode: "full",
        passwordStrengthCheck: false,
      };

      const logger = createConsoleLogger("fastify-v3-api", testGlobalLogLevel);
      server = await startFastifyServer(testConfig, logger);
    });

    test("should require authentication for V3 service index", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/index.json`,
      );
      expect(response.status).toBe(401);
    });

    test("should allow session authentication for V3 service index", async () => {
      // First login to get session
      const loginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testadminv3",
            password: "adminpass",
          }),
        },
      );

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get("set-cookie") || "";
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];

      // Use session to access V3 API
      const v3Response = await fetch(
        `http://localhost:${serverPort}/v3/index.json`,
        {
          headers: {
            Cookie: `sessionToken=${sessionToken}`,
          },
        },
      );

      expect(v3Response.status).toBe(200);
      const data = await v3Response.json();
      expect(data).toHaveProperty(
        "@context",
        "https://api.nuget.org/v3/index.json",
      );
      expect(data).toHaveProperty("version");
    });

    test("should allow Basic authentication for V3 service index", async () => {
      // Use Basic authentication
      const credentials = Buffer.from("testadminv3:admin-api-key-123").toString(
        "base64",
      );
      const response = await fetch(
        `http://localhost:${serverPort}/v3/index.json`,
        {
          headers: {
            Authorization: `Basic ${credentials}`,
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty(
        "@context",
        "https://api.nuget.org/v3/index.json",
      );
      expect(data).toHaveProperty("version");
    });

    test("should prioritize session authentication over Basic auth", async () => {
      // First login to get session
      const loginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testadminv3",
            password: "adminpass",
          }),
        },
      );

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get("set-cookie") || "";
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];

      // Use both session and Basic auth (session should take priority)
      const invalidCredentials =
        Buffer.from("invalid:invalid").toString("base64");
      const response = await fetch(
        `http://localhost:${serverPort}/v3/index.json`,
        {
          headers: {
            Cookie: `sessionToken=${sessionToken}`,
            Authorization: `Basic ${invalidCredentials}`, // Invalid Basic auth should be ignored
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty(
        "@context",
        "https://api.nuget.org/v3/index.json",
      );
    });

    test("should require authentication for V3 search", async () => {
      const response = await fetch(`http://localhost:${serverPort}/v3/search`);
      expect(response.status).toBe(401);
    });

    test("should require authentication for package download", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/package/nonexistent/1.0.0/nonexistent.1.0.0.nupkg`,
      );
      expect(response.status).toBe(401);
    });

    test("should require authentication for package registration", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/registrations/nonexistent/index.json`,
      );
      expect(response.status).toBe(401);
    });

    test("should require authentication for package versions list", async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/v3/package/nonexistent/index.json`,
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/Basic realm=/);
    });

    test("should allow authenticated access to package versions list", async () => {
      // First login to get session
      const loginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testadminv3",
            password: "adminpass",
          }),
        },
      );

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get("set-cookie") || "";
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];

      // Access package versions list with session
      const response = await fetch(
        `http://localhost:${serverPort}/v3/package/nonexistent/index.json`,
        {
          headers: {
            Cookie: `sessionToken=${sessionToken}`,
          },
        },
      );

      // Should return 404 for non-existent package even with valid auth
      expect(response.status).toBe(404);
    });
  });
});
