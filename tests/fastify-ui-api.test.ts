import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { startFastifyServer, FastifyServerInstance } from "../src/server";
import { createConsoleLogger } from "../src/logger";
import { ServerConfig } from "../src/types";
import {
  createTestDirectory,
  getTestPort,
  testGlobalLogLevel,
  waitForServerReady,
} from "./helpers/test-helper.js";

/**
 * Fastify UI Backend API Tests - Phase 4
 *
 * Tests Fastify server UI Backend API implementation including:
 * - POST /api/ui/config (public endpoint)
 * - POST /api/ui/users (admin session required)
 * - POST /api/ui/apipassword (session required)
 * - POST /api/ui/password (session required)
 * - GET /api/ui/icon/{id}/{version} (auth based on mode)
 * - POST /api/publish (hybrid auth based on mode)
 * - Authentication requirements based on authMode
 * - Session-based authentication integration
 */
describe("Fastify UI Backend API - Phase 4 Tests", () => {
  let testBaseDir: string;
  let testConfigDir: string;
  let testPackagesDir: string;
  let serverPort: number;
  const logger = createConsoleLogger("fastify-ui-api", testGlobalLogLevel);

  // Helper to start server with specific auth mode
  const startServerWithAuth = (
    authMode: "none" | "publish" | "full",
    port: number,
  ): Promise<FastifyServerInstance> => {
    const config: ServerConfig = {
      port,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: `Test Fastify UI Server - ${authMode}`,
      logLevel: testGlobalLogLevel,
      authMode,
      passwordStrengthCheck: false, // Disable password strength check for testing
    };
    return startFastifyServer(config, logger);
  };

  // Helper to login and get session token
  const loginAndGetSession = async (
    username: string,
    password: string,
    port: number,
  ): Promise<string> => {
    const loginResponse = await fetch(
      `http://localhost:${port}/api/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      },
    );

    if (loginResponse.status !== 200) {
      throw new Error(`Login failed with status ${loginResponse.status}`);
    }

    const cookies = loginResponse.headers.get("set-cookie") || "";
    const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1] || "";
    if (!sessionToken) {
      throw new Error("No session token in login response");
    }
    return sessionToken;
  };

  // Create test users for authentication tests
  const createTestUsers = async () => {
    const testUsers = [
      {
        id: "test-admin-ui",
        username: "testadminui",
        passwordHash: "PSRt9HqDyLtH7LC8iUnS7F9ObKU=", // password: "adminpass"
        salt: "test-salt-admin-ui",
        apiPasswordHash: "fEE9WeQqltjkrNwKP6WZb4lPLJ0=", // apiPassword: "admin-api-key-123"
        apiPasswordSalt: "test-api-salt-admin-ui",
        role: "admin",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-publish-ui",
        username: "testpublishui",
        passwordHash: "OxSWKpMyC4Ycbk6AVlacKvtFzp4=", // password: "publishpass"
        salt: "test-salt-publish-ui",
        apiPasswordHash: "kRHDw5YZn/Ic+ynzwmVQvFdFCJw=", // apiPassword: "publish-api-key-123"
        apiPasswordSalt: "test-api-salt-publish-ui",
        role: "publish",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-read-ui",
        username: "testreadui",
        passwordHash: "kB94DvNnBYRvYaV/ZGoHQCyK1/k=", // password: "readpass"
        salt: "test-salt-read-ui",
        apiPasswordHash: "DRkROp0nFzqicoShFhroRDxemVE=", // apiPassword: "read-api-key-123"
        apiPasswordSalt: "test-api-salt-read-ui",
        role: "read",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];

    await fs.writeFile(
      path.join(testConfigDir, "users.json"),
      JSON.stringify(testUsers, null, 2),
    );
  };

  const setupTestPackage = async () => {
    // Use actual test package from fixtures
    const sourcePackage = path.join(
      __dirname,
      "fixtures",
      "packages",
      "FlashCap.1.10.0.nupkg",
    );
    const packageDir = path.join(testPackagesDir, "FlashCap", "1.10.0");
    await fs.mkdir(packageDir, { recursive: true });

    // Copy the nupkg file
    await fs.copyFile(
      sourcePackage,
      path.join(packageDir, "FlashCap.1.10.0.nupkg"),
    );

    // Extract necessary files from the nupkg using AdmZip
    const zip = new AdmZip(sourcePackage);
    const zipEntries = zip.getEntries();

    // Extract and copy the nuspec file
    const nuspecEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.nuspec",
    );
    if (nuspecEntry) {
      await fs.writeFile(
        path.join(packageDir, "FlashCap.nuspec"),
        nuspecEntry.getData(),
      );
    }

    // Extract and copy icon file if exists
    const iconEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.100.png",
    );
    if (iconEntry) {
      await fs.writeFile(
        path.join(packageDir, "icon.png"),
        iconEntry.getData(),
      );
    }
  };

  beforeEach(async (fn) => {
    // Create isolated test directory for each test
    testBaseDir = await createTestDirectory("fastify-ui-api", fn.task.name);
    testConfigDir = testBaseDir;
    testPackagesDir = path.join(testBaseDir, "packages");

    // Create test directories and data
    await fs.mkdir(testPackagesDir, { recursive: true });
    await createTestUsers();
    await setupTestPackage();

    // Start server with isolated directories
    serverPort = getTestPort(7000);
  }, 30000);

  // POST /api/ui/config tests
  test("POST /api/ui/config - should return server configuration without authentication (authMode: none)", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - None",
      logLevel: testGlobalLogLevel,
      authMode: "none",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/config`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("realm");
      expect(data).toHaveProperty("name", "nuget-server");
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("authMode", "none");
      expect(data).toHaveProperty("authEnabled");
      expect(data.authEnabled).toHaveProperty("general", false);
      expect(data.authEnabled).toHaveProperty("publish", false);
      expect(data.authEnabled).toHaveProperty("admin", false);
      expect(data).toHaveProperty("currentUser", null); // No authentication
    } finally {
      await server.close();
    }
  }, 30000);

  test("POST /api/ui/config - should detect session authentication in config", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Full",
      logLevel: testGlobalLogLevel,
      authMode: "full",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // First login to get session
      const loginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testadminui",
            password: "adminpass",
          }),
        },
      );

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get("set-cookie") || "";
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];

      // Use session to access config
      const configResponse = await fetch(
        `http://localhost:${serverPort}/api/ui/config`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: JSON.stringify({}),
        },
      );

      expect(configResponse.status).toBe(200);
      const data = await configResponse.json();
      expect(data.currentUser).toBeTruthy();
      expect(data.currentUser.username).toBe("testadminui");
      expect(data.currentUser.role).toBe("admin");
      expect(data.currentUser.authenticated).toBe(true);
    } finally {
      await server.close();
    }
  }, 30000);

  test("POST /api/ui/config - should detect Basic authentication in config", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Full",
      logLevel: testGlobalLogLevel,
      authMode: "full",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Use Basic authentication to access config
      const credentials = Buffer.from("testadminui:admin-api-key-123").toString(
        "base64",
      );
      const configResponse = await fetch(
        `http://localhost:${serverPort}/api/ui/config`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${credentials}`,
          },
          body: JSON.stringify({}),
        },
      );

      expect(configResponse.status).toBe(200);
      const data = await configResponse.json();
      expect(data.currentUser).toBeTruthy();
      expect(data.currentUser.username).toBe("testadminui");
      expect(data.currentUser.role).toBe("admin");
      expect(data.currentUser.authenticated).toBe(true);
    } finally {
      await server.close();
    }
  }, 30000);

  test("POST /api/ui/config - should return config without authentication in authMode=full", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Full Auth",
      logLevel: testGlobalLogLevel,
      authMode: "full",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Access without authentication
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/config`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      // Should succeed without authentication even in authMode=full
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("authMode", "full");
      expect(data).toHaveProperty("currentUser", null); // Not authenticated
    } finally {
      await server.close();
    }
  }, 30000);

  test("POST /api/ui/config - should handle browser Accept headers correctly", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Full Auth",
      logLevel: testGlobalLogLevel,
      authMode: "full",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Simulate browser request with default Accept header
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/config`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "*/*", // Browser default
          },
          body: JSON.stringify({}),
        },
      );

      // Should not return 401
      expect(response.status).toBe(200);

      // Should not have WWW-Authenticate header
      expect(response.headers.get("www-authenticate")).toBeNull();
    } finally {
      await server.close();
    }
  }, 30000);

  // POST /api/ui/users tests
  test("POST /api/ui/users - should require session authentication for user management", async () => {
    const server = await startServerWithAuth("publish", serverPort);
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/users`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "list",
          }),
        },
      );

      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 30000);

  test("POST /api/ui/users - should list users with admin session authentication", async () => {
    const server = await startServerWithAuth("publish", serverPort);
    try {
      const sessionToken = await loginAndGetSession(
        "testadminui",
        "adminpass",
        serverPort,
      );

      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/users`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: JSON.stringify({
            action: "list",
          }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("users");
      expect(Array.isArray(data.users)).toBe(true);
      expect(data.users.length).toBeGreaterThan(0);
      expect(data.users[0]).toHaveProperty("username");
      expect(data.users[0]).toHaveProperty("role");
    } finally {
      await server.close();
    }
  }, 30000);

  test("POST /api/ui/users - should create a new user with admin session authentication", async () => {
    const server = await startServerWithAuth("publish", serverPort);
    try {
      const sessionToken = await loginAndGetSession(
        "testadminui",
        "adminpass",
        serverPort,
      );

      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/users`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: JSON.stringify({
            action: "create",
            username: "newuser",
            password: "newpass123",
            role: "read",
          }),
        },
      );

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty("user");
      expect(data.user.username).toBe("newuser");
      expect(data.user.role).toBe("read");
      // API password is no longer returned on user creation
      expect(data).not.toHaveProperty("apiPassword");
    } finally {
      await server.close();
    }
  }, 30000);

  test("POST /api/ui/users - should delete a user with admin session authentication", async () => {
    const server = await startServerWithAuth("publish", serverPort);
    try {
      const sessionToken = await loginAndGetSession(
        "testadminui",
        "adminpass",
        serverPort,
      );

      // First create a user to delete
      await fetch(`http://localhost:${serverPort}/api/ui/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `sessionToken=${sessionToken}`,
        },
        body: JSON.stringify({
          action: "create",
          username: "userToDelete",
          password: "temp123",
          role: "read",
        }),
      });

      // Then delete the user
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/users`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: JSON.stringify({
            action: "delete",
            username: "userToDelete",
          }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("message", "User deleted successfully");
    } finally {
      await server.close();
    }
  }, 30000);

  test("POST /api/ui/users - should reject non-admin user for user management", async () => {
    const server = await startServerWithAuth("publish", serverPort);
    try {
      // Login as publish user (not admin)
      const publishSessionToken = await loginAndGetSession(
        "testpublishui",
        "publishpass",
        serverPort,
      );

      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/users`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${publishSessionToken}`,
          },
          body: JSON.stringify({
            action: "list",
          }),
        },
      );

      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  }, 30000);
});

describe("Fastify UI API - POST /api/ui/apipassword (session required)", () => {
  let testBaseDir: string;
  let testConfigDir: string;
  let testPackagesDir: string;
  let serverPort: number;
  let sessionToken: string;
  const logger = createConsoleLogger(
    "fastify-ui-api-apikey",
    testGlobalLogLevel,
  );

  beforeEach(async (fn) => {
    // Create isolated test directory for each test
    testBaseDir = await createTestDirectory(
      "fastify-ui-api-apikey",
      fn.task.name,
    );
    testConfigDir = testBaseDir;
    testPackagesDir = path.join(testBaseDir, "packages");

    // Create test directories and data
    await fs.mkdir(testPackagesDir, { recursive: true });
    await createTestUsers();
    await setupTestPackage();

    // Generate unique port for this test group
    serverPort = getTestPort(7200);
  }, 30000);

  const createServerAndEnvironment = async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Full",
      logLevel: testGlobalLogLevel,
      authMode: "full",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Login to get session token
      const loginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testpublishui",
            password: "publishpass",
          }),
        },
      );

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get("set-cookie") || "";
      sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1] || "";
      expect(sessionToken).toBeTruthy();
    } catch (error: any) {
      await server.close();
      throw error;
    }

    return server;
  };

  // Helper functions (duplicated for independence)
  const createTestUsers = async () => {
    const testUsers = [
      {
        id: "test-admin-ui",
        username: "testadminui",
        passwordHash: "PSRt9HqDyLtH7LC8iUnS7F9ObKU=", // password: "adminpass"
        salt: "test-salt-admin-ui",
        apiPasswordHash: "fEE9WeQqltjkrNwKP6WZb4lPLJ0=", // apiPassword: "admin-api-key-123"
        apiPasswordSalt: "test-api-salt-admin-ui",
        role: "admin",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-publish-ui",
        username: "testpublishui",
        passwordHash: "OxSWKpMyC4Ycbk6AVlacKvtFzp4=", // password: "publishpass"
        salt: "test-salt-publish-ui",
        apiPasswordHash: "kRHDw5YZn/Ic+ynzwmVQvFdFCJw=", // apiPassword: "publish-api-key-123"
        apiPasswordSalt: "test-api-salt-publish-ui",
        role: "publish",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-read-ui",
        username: "testreadui",
        passwordHash: "kB94DvNnBYRvYaV/ZGoHQCyK1/k=", // password: "readpass"
        salt: "test-salt-read-ui",
        apiPasswordHash: "DRkROp0nFzqicoShFhroRDxemVE=", // apiPassword: "read-api-key-123"
        apiPasswordSalt: "test-api-salt-read-ui",
        role: "read",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];

    await fs.writeFile(
      path.join(testConfigDir, "users.json"),
      JSON.stringify(testUsers, null, 2),
    );
  };

  const setupTestPackage = async () => {
    // Use actual test package from fixtures
    const sourcePackage = path.join(
      __dirname,
      "fixtures",
      "packages",
      "FlashCap.1.10.0.nupkg",
    );
    const packageDir = path.join(testPackagesDir, "FlashCap", "1.10.0");
    await fs.mkdir(packageDir, { recursive: true });

    // Copy the nupkg file
    await fs.copyFile(
      sourcePackage,
      path.join(packageDir, "FlashCap.1.10.0.nupkg"),
    );

    // Extract necessary files from the nupkg using AdmZip
    const zip = new AdmZip(sourcePackage);
    const zipEntries = zip.getEntries();

    // Extract and copy the nuspec file
    const nuspecEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.nuspec",
    );
    if (nuspecEntry) {
      await fs.writeFile(
        path.join(packageDir, "FlashCap.nuspec"),
        nuspecEntry.getData(),
      );
    }

    // Extract and copy icon file if exists
    const iconEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.100.png",
    );
    if (iconEntry) {
      await fs.writeFile(
        path.join(packageDir, "icon.png"),
        iconEntry.getData(),
      );
    }
  };

  test("should require session authentication for API password regeneration", async () => {
    const server = await createServerAndEnvironment();
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/apipassword`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 30000);

  test("should regenerate API password with session authentication", async () => {
    const server = await createServerAndEnvironment();
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/apipassword`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("apiPassword");
      expect(data).toHaveProperty("username", "testpublishui");
      expect(typeof data.apiPassword).toBe("string");
      expect(data.apiPassword.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 30000);
});

describe("Fastify UI API - POST /api/ui/password (session required)", () => {
  let testBaseDir: string;
  let testConfigDir: string;
  let testPackagesDir: string;
  let serverPort: number;
  let sessionToken: string;
  let adminSessionToken: string;
  const logger = createConsoleLogger(
    "fastify-ui-api-password",
    testGlobalLogLevel,
  );

  beforeEach(async (fn) => {
    // Create isolated test directory for each test
    testBaseDir = await createTestDirectory(
      "fastify-ui-api-password",
      fn.task.name,
    );
    testConfigDir = testBaseDir;
    testPackagesDir = path.join(testBaseDir, "packages");

    // Create test directories and data
    await fs.mkdir(testPackagesDir, { recursive: true });
    await createTestUsers();
    await setupTestPackage();

    // Generate unique port for this test group
    serverPort = getTestPort(7300);
  }, 30000);

  const createServerAndEnvironment = async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Full",
      logLevel: testGlobalLogLevel,
      authMode: "full",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Login as regular user to get session token
      const loginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testpublishui",
            password: "publishpass",
          }),
        },
      );

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get("set-cookie") || "";
      sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1] || "";
      expect(sessionToken).toBeTruthy();

      // Also login as admin for admin tests
      const adminLoginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testadminui",
            password: "adminpass",
          }),
        },
      );

      expect(adminLoginResponse.status).toBe(200);
      const adminCookies = adminLoginResponse.headers.get("set-cookie") || "";
      adminSessionToken = adminCookies.match(/sessionToken=([^;]+)/)?.[1] || "";
      expect(adminSessionToken).toBeTruthy();

      return server;
    } catch (error: any) {
      await server.close();
      throw error;
    }
  };

  // Helper functions (duplicated for independence)
  const createTestUsers = async () => {
    const testUsers = [
      {
        id: "test-admin-ui",
        username: "testadminui",
        passwordHash: "PSRt9HqDyLtH7LC8iUnS7F9ObKU=", // password: "adminpass"
        salt: "test-salt-admin-ui",
        apiPasswordHash: "fEE9WeQqltjkrNwKP6WZb4lPLJ0=", // apiPassword: "admin-api-key-123"
        apiPasswordSalt: "test-api-salt-admin-ui",
        role: "admin",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-publish-ui",
        username: "testpublishui",
        passwordHash: "OxSWKpMyC4Ycbk6AVlacKvtFzp4=", // password: "publishpass"
        salt: "test-salt-publish-ui",
        apiPasswordHash: "kRHDw5YZn/Ic+ynzwmVQvFdFCJw=", // apiPassword: "publish-api-key-123"
        apiPasswordSalt: "test-api-salt-publish-ui",
        role: "publish",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-read-ui",
        username: "testreadui",
        passwordHash: "kB94DvNnBYRvYaV/ZGoHQCyK1/k=", // password: "readpass"
        salt: "test-salt-read-ui",
        apiPasswordHash: "DRkROp0nFzqicoShFhroRDxemVE=", // apiPassword: "read-api-key-123"
        apiPasswordSalt: "test-api-salt-read-ui",
        role: "read",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];

    await fs.writeFile(
      path.join(testConfigDir, "users.json"),
      JSON.stringify(testUsers, null, 2),
    );
  };

  const setupTestPackage = async () => {
    // Use actual test package from fixtures
    const sourcePackage = path.join(
      __dirname,
      "fixtures",
      "packages",
      "FlashCap.1.10.0.nupkg",
    );
    const packageDir = path.join(testPackagesDir, "FlashCap", "1.10.0");
    await fs.mkdir(packageDir, { recursive: true });

    // Copy the nupkg file
    await fs.copyFile(
      sourcePackage,
      path.join(packageDir, "FlashCap.1.10.0.nupkg"),
    );

    // Extract necessary files from the nupkg using AdmZip
    const zip = new AdmZip(sourcePackage);
    const zipEntries = zip.getEntries();

    // Extract and copy the nuspec file
    const nuspecEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.nuspec",
    );
    if (nuspecEntry) {
      await fs.writeFile(
        path.join(packageDir, "FlashCap.nuspec"),
        nuspecEntry.getData(),
      );
    }

    // Extract and copy icon file if exists
    const iconEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.100.png",
    );
    if (iconEntry) {
      await fs.writeFile(
        path.join(packageDir, "icon.png"),
        iconEntry.getData(),
      );
    }
  };

  test("should require session authentication for password change", async () => {
    const server = await createServerAndEnvironment();
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            currentPassword: "publishpass",
            newPassword: "newpass123",
          }),
        },
      );

      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 30000);

  test("should change own password with session authentication", async () => {
    const server = await createServerAndEnvironment();
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: JSON.stringify({
            currentPassword: "publishpass",
            newPassword: "newpass123",
          }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("message", "Password updated successfully");
    } finally {
      await server.close();
    }
  }, 30000);

  test("should reject incorrect current password", async () => {
    const server = await createServerAndEnvironment();
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: JSON.stringify({
            currentPassword: "wrongpassword",
            newPassword: "newpass123",
          }),
        },
      );

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty("error", "Current password is incorrect");
    } finally {
      await server.close();
    }
  }, 30000);

  test("should allow admin to change other user password", async () => {
    const server = await createServerAndEnvironment();
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${adminSessionToken}`,
          },
          body: JSON.stringify({
            username: "testpublishui",
            newPassword: "adminSetPassword",
          }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("message", "Password updated successfully");
    } finally {
      await server.close();
    }
  }, 30000);

  test("should reject non-admin user changing other user password", async () => {
    const server = await createServerAndEnvironment();
    try {
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: JSON.stringify({
            username: "testadminui",
            newPassword: "hackattempt",
          }),
        },
      );

      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  }, 30000);
});

describe("Fastify UI API - GET /api/ui/icon/{id}/{version} (auth based on mode)", () => {
  let testBaseDir: string;
  let testConfigDir: string;
  let testPackagesDir: string;
  let serverPort: number;
  const logger = createConsoleLogger("fastify-ui-api-icon", testGlobalLogLevel);

  beforeEach(async (fn) => {
    // Create isolated test directory for each test
    testBaseDir = await createTestDirectory(
      "fastify-ui-api-icon",
      fn.task.name,
    );
    testConfigDir = testBaseDir;
    testPackagesDir = path.join(testBaseDir, "packages");

    // Create test directories and data
    await fs.mkdir(testPackagesDir, { recursive: true });
    await createTestUsers();
    await setupTestPackage();

    // Generate unique port for this test group
    serverPort = getTestPort(7400);
  }, 30000);

  // Helper functions (duplicated for independence)
  const createTestUsers = async () => {
    const testUsers = [
      {
        id: "test-admin-ui",
        username: "testadminui",
        passwordHash: "PSRt9HqDyLtH7LC8iUnS7F9ObKU=", // password: "adminpass"
        salt: "test-salt-admin-ui",
        apiPasswordHash: "fEE9WeQqltjkrNwKP6WZb4lPLJ0=", // apiPassword: "admin-api-key-123"
        apiPasswordSalt: "test-api-salt-admin-ui",
        role: "admin",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-publish-ui",
        username: "testpublishui",
        passwordHash: "OxSWKpMyC4Ycbk6AVlacKvtFzp4=", // password: "publishpass"
        salt: "test-salt-publish-ui",
        apiPasswordHash: "kRHDw5YZn/Ic+ynzwmVQvFdFCJw=", // apiPassword: "publish-api-key-123"
        apiPasswordSalt: "test-api-salt-publish-ui",
        role: "publish",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-read-ui",
        username: "testreadui",
        passwordHash: "kB94DvNnBYRvYaV/ZGoHQCyK1/k=", // password: "readpass"
        salt: "test-salt-read-ui",
        apiPasswordHash: "DRkROp0nFzqicoShFhroRDxemVE=", // apiPassword: "read-api-key-123"
        apiPasswordSalt: "test-api-salt-read-ui",
        role: "read",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];

    await fs.writeFile(
      path.join(testConfigDir, "users.json"),
      JSON.stringify(testUsers, null, 2),
    );
  };

  const setupTestPackage = async () => {
    // Use actual test package from fixtures
    const sourcePackage = path.join(
      __dirname,
      "fixtures",
      "packages",
      "FlashCap.1.10.0.nupkg",
    );
    const packageDir = path.join(testPackagesDir, "FlashCap", "1.10.0");
    await fs.mkdir(packageDir, { recursive: true });

    // Copy the nupkg file
    await fs.copyFile(
      sourcePackage,
      path.join(packageDir, "FlashCap.1.10.0.nupkg"),
    );

    // Extract necessary files from the nupkg using AdmZip
    const zip = new AdmZip(sourcePackage);
    const zipEntries = zip.getEntries();

    // Extract and copy the nuspec file
    const nuspecEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.nuspec",
    );
    if (nuspecEntry) {
      await fs.writeFile(
        path.join(packageDir, "FlashCap.nuspec"),
        nuspecEntry.getData(),
      );
    }

    // Extract and copy icon file if exists
    const iconEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.100.png",
    );
    if (iconEntry) {
      await fs.writeFile(
        path.join(packageDir, "icon.png"),
        iconEntry.getData(),
      );
    }
  };

  test("should serve icon without authentication (authMode: none)", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - None",
      logLevel: testGlobalLogLevel,
      authMode: "none",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      await waitForServerReady(serverPort, "none");

      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/icon/FlashCap/1.10.0`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      const buffer = await response.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 30000);

  test("should serve icon without authentication (authMode: publish)", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Publish",
      logLevel: testGlobalLogLevel,
      authMode: "publish",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      await waitForServerReady(serverPort, "publish");

      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/icon/FlashCap/1.10.0`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      // Consume response body to prevent stream hanging
      const buffer = await response.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 30000);

  test("should require authentication for icon (authMode: full)", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Full",
      logLevel: testGlobalLogLevel,
      authMode: "full",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      await waitForServerReady(serverPort, "full");

      // Without authentication
      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/icon/FlashCap/1.10.0`,
      );
      expect(response.status).toBe(401);

      // With session authentication
      const loginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testadminui",
            password: "adminpass",
          }),
        },
      );

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get("set-cookie") || "";
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];

      const authResponse = await fetch(
        `http://localhost:${serverPort}/api/ui/icon/FlashCap/1.10.0`,
        {
          headers: {
            Cookie: `sessionToken=${sessionToken}`,
          },
        },
      );

      expect(authResponse.status).toBe(200);
      expect(authResponse.headers.get("content-type")).toBe("image/png");
      // Consume response body to prevent stream hanging
      const authBuffer = await authResponse.arrayBuffer();
      expect(authBuffer.byteLength).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 30000);

  test("should return 404 for non-existent icon", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - None",
      logLevel: testGlobalLogLevel,
      authMode: "none",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      await waitForServerReady(serverPort, "none");

      const response = await fetch(
        `http://localhost:${serverPort}/api/ui/icon/nonexistent/1.0.0`,
      );

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  }, 30000);
});

describe("Fastify UI API - POST /api/publish (hybrid auth based on mode)", () => {
  let testBaseDir: string;
  let testConfigDir: string;
  let testPackagesDir: string;
  let serverPort: number;
  const logger = createConsoleLogger(
    "fastify-ui-api-publish",
    testGlobalLogLevel,
  );

  beforeEach(async (fn) => {
    // Create isolated test directory for each test
    testBaseDir = await createTestDirectory(
      "fastify-ui-api-publish",
      fn.task.name,
    );
    testConfigDir = testBaseDir;
    testPackagesDir = path.join(testBaseDir, "packages");

    // Create test directories and data
    await fs.mkdir(testPackagesDir, { recursive: true });
    await createTestUsers();
    await setupTestPackage();

    // Generate unique port for this test group
    serverPort = getTestPort(7500);
  }, 30000);

  // Helper functions (duplicated for independence)
  const createTestUsers = async () => {
    const testUsers = [
      {
        id: "test-admin-ui",
        username: "testadminui",
        passwordHash: "PSRt9HqDyLtH7LC8iUnS7F9ObKU=", // password: "adminpass"
        salt: "test-salt-admin-ui",
        apiPasswordHash: "fEE9WeQqltjkrNwKP6WZb4lPLJ0=", // apiPassword: "admin-api-key-123"
        apiPasswordSalt: "test-api-salt-admin-ui",
        role: "admin",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-publish-ui",
        username: "testpublishui",
        passwordHash: "OxSWKpMyC4Ycbk6AVlacKvtFzp4=", // password: "publishpass"
        salt: "test-salt-publish-ui",
        apiPasswordHash: "kRHDw5YZn/Ic+ynzwmVQvFdFCJw=", // apiPassword: "publish-api-key-123"
        apiPasswordSalt: "test-api-salt-publish-ui",
        role: "publish",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "test-read-ui",
        username: "testreadui",
        passwordHash: "kB94DvNnBYRvYaV/ZGoHQCyK1/k=", // password: "readpass"
        salt: "test-salt-read-ui",
        apiPasswordHash: "DRkROp0nFzqicoShFhroRDxemVE=", // apiPassword: "read-api-key-123"
        apiPasswordSalt: "test-api-salt-read-ui",
        role: "read",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];

    await fs.writeFile(
      path.join(testConfigDir, "users.json"),
      JSON.stringify(testUsers, null, 2),
    );
  };

  const setupTestPackage = async () => {
    // Use actual test package from fixtures
    const sourcePackage = path.join(
      __dirname,
      "fixtures",
      "packages",
      "FlashCap.1.10.0.nupkg",
    );
    const packageDir = path.join(testPackagesDir, "FlashCap", "1.10.0");
    await fs.mkdir(packageDir, { recursive: true });

    // Copy the nupkg file
    await fs.copyFile(
      sourcePackage,
      path.join(packageDir, "FlashCap.1.10.0.nupkg"),
    );

    // Extract necessary files from the nupkg using AdmZip
    const zip = new AdmZip(sourcePackage);
    const zipEntries = zip.getEntries();

    // Extract and copy the nuspec file
    const nuspecEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.nuspec",
    );
    if (nuspecEntry) {
      await fs.writeFile(
        path.join(packageDir, "FlashCap.nuspec"),
        nuspecEntry.getData(),
      );
    }

    // Extract and copy icon file if exists
    const iconEntry = zipEntries.find(
      (entry) => entry.entryName === "FlashCap.100.png",
    );
    if (iconEntry) {
      await fs.writeFile(
        path.join(packageDir, "icon.png"),
        iconEntry.getData(),
      );
    }
  };

  test("should allow publish without authentication (authMode: none)", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - None",
      logLevel: testGlobalLogLevel,
      authMode: "none",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Use a fixture package for testing
      const fixturePackagePath = path.join(
        __dirname,
        "fixtures",
        "packages",
        "GitReader.1.15.0.nupkg",
      );
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      const response = await fetch(
        `http://localhost:${serverPort}/api/publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(testPackageBuffer),
        },
      );

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty("message", "Package uploaded successfully");
      expect(data).toHaveProperty("id", "GitReader");
      expect(data).toHaveProperty("version", "1.15.0");
    } finally {
      await server.close();
    }
  }, 30000);

  test("should require authentication for publish (authMode: publish)", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Publish",
      logLevel: testGlobalLogLevel,
      authMode: "publish",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Use a fixture package for testing
      const fixturePackagePath = path.join(
        __dirname,
        "fixtures",
        "packages",
        "GitReader.1.15.0.nupkg",
      );
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      // Without authentication
      const response = await fetch(
        `http://localhost:${serverPort}/api/publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(testPackageBuffer),
        },
      );

      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 30000);

  test("should allow publish with session authentication (authMode: publish)", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Publish",
      logLevel: testGlobalLogLevel,
      authMode: "publish",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Login to get session
      const loginResponse = await fetch(
        `http://localhost:${serverPort}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "testpublishui",
            password: "publishpass",
          }),
        },
      );

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get("set-cookie") || "";
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];

      // Use a fixture package for testing
      const fixturePackagePath = path.join(
        __dirname,
        "fixtures",
        "packages",
        "GitReader.1.15.0.nupkg",
      );
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      const response = await fetch(
        `http://localhost:${serverPort}/api/publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            Cookie: `sessionToken=${sessionToken}`,
          },
          body: new Uint8Array(testPackageBuffer),
        },
      );

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty("message", "Package uploaded successfully");
      expect(data).toHaveProperty("id", "GitReader");
      expect(data).toHaveProperty("version", "1.15.0");
    } finally {
      await server.close();
    }
  }, 30000);

  test("should allow publish with Basic authentication (authMode: publish)", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Publish",
      logLevel: testGlobalLogLevel,
      authMode: "publish",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Use a fixture package for testing
      const fixturePackagePath = path.join(
        __dirname,
        "fixtures",
        "packages",
        "GitReader.1.15.0.nupkg",
      );
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      // Use Basic authentication
      const credentials = Buffer.from(
        "testpublishui:publish-api-key-123",
      ).toString("base64");
      const response = await fetch(
        `http://localhost:${serverPort}/api/publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: `Basic ${credentials}`,
          },
          body: new Uint8Array(testPackageBuffer),
        },
      );

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty("message", "Package uploaded successfully");
      expect(data).toHaveProperty("id", "GitReader");
      expect(data).toHaveProperty("version", "1.15.0");
    } finally {
      await server.close();
    }
  }, 30000);

  test("should reject read-only user for publish", async () => {
    const config: ServerConfig = {
      port: serverPort,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: "Test Fastify UI Server - Publish",
      logLevel: testGlobalLogLevel,
      authMode: "publish",
      passwordStrengthCheck: false,
    };

    const server = await startFastifyServer(config, logger);
    try {
      // Use a fixture package for testing
      const fixturePackagePath = path.join(
        __dirname,
        "fixtures",
        "packages",
        "GitReader.1.15.0.nupkg",
      );
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      // Use Basic authentication with read user
      const credentials = Buffer.from("testreadui:read-api-key-123").toString(
        "base64",
      );
      const response = await fetch(
        `http://localhost:${serverPort}/api/publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: `Basic ${credentials}`,
          },
          body: new Uint8Array(testPackageBuffer),
        },
      );

      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  }, 30000);
});
