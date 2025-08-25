import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { startFastifyServer, FastifyServerInstance } from '../src/server';
import { createConsoleLogger } from '../src/logger';
import { ServerConfig } from '../src/types';
import { createTestDirectory, getTestPort, testGlobalLogLevel } from './helpers/test-helper.js';
import { execSync } from 'child_process';

/**
 * Fastify UI Backend API Tests - Phase 4
 * 
 * Tests Fastify server UI Backend API implementation including:
 * - POST /api/ui/config (public endpoint)
 * - POST /api/ui/users (admin session required)
 * - POST /api/ui/apikey (session required)
 * - POST /api/ui/password (session required)
 * - GET /api/ui/icon/{id}/{version} (auth based on mode)
 * - POST /api/publish (hybrid auth based on mode)
 * - Authentication requirements based on authMode
 * - Session-based authentication integration
 */
describe('Fastify UI Backend API - Phase 4 Tests', () => {
  let server: FastifyServerInstance | null = null;
  let testBaseDir: string;
  let testConfigDir: string;
  let testPackagesDir: string;
  let serverPort: number;
  const logger = createConsoleLogger('fastify-ui-api', testGlobalLogLevel);

  // Helper to start server with specific auth mode
  const startServerWithAuth = async (authMode: 'none' | 'publish' | 'full', port: number): Promise<FastifyServerInstance> => {
    const config: ServerConfig = {
      port,
      packageDir: testPackagesDir,
      configDir: testConfigDir,
      realm: `Test Fastify UI Server - ${authMode}`,
      logLevel: testGlobalLogLevel,
      noUi: false,
      authMode
    };
    return await startFastifyServer(config, logger);
  }

  // Helper to login and get session token
  const loginAndGetSession = async (username: string, password: string, port: number): Promise<string> => {
    const loginResponse = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    if (loginResponse.status !== 200) {
      throw new Error(`Login failed with status ${loginResponse.status}`);
    }
    
    const cookies = loginResponse.headers.get('set-cookie') || '';
    const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1] || '';
    if (!sessionToken) {
      throw new Error('No session token in login response');
    }
    return sessionToken;
  }

  // Create test users for authentication tests
  const createTestUsers = async () => {
    const testUsers = [
      {
        id: "test-admin-ui",
        username: "testadminui",
        passwordHash: "PSRt9HqDyLtH7LC8iUnS7F9ObKU=", // password: "adminpass"
        salt: "test-salt-admin-ui",
        apiKeyHash: "fEE9WeQqltjkrNwKP6WZb4lPLJ0=", // apiKey: "admin-api-key-123"  
        apiKeySalt: "test-api-salt-admin-ui",
        role: "admin",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z"
      },
      {
        id: "test-publish-ui",
        username: "testpublishui",
        passwordHash: "OxSWKpMyC4Ycbk6AVlacKvtFzp4=", // password: "publishpass"
        salt: "test-salt-publish-ui",
        apiKeyHash: "kRHDw5YZn/Ic+ynzwmVQvFdFCJw=", // apiKey: "publish-api-key-123"
        apiKeySalt: "test-api-salt-publish-ui",
        role: "publish",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z"
      },
      {
        id: "test-read-ui",
        username: "testreadui",
        passwordHash: "kB94DvNnBYRvYaV/ZGoHQCyK1/k=", // password: "readpass"
        salt: "test-salt-read-ui",
        apiKeyHash: "DRkROp0nFzqicoShFhroRDxemVE=", // apiKey: "read-api-key-123"
        apiKeySalt: "test-api-salt-read-ui",
        role: "read",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z"
      }
    ];

    await fs.writeFile(
      path.join(testConfigDir, 'users.json'),
      JSON.stringify(testUsers, null, 2)
    );
  };

  const setupTestPackage = async () => {
    // Use actual test package from fixtures
    const sourcePackage = path.join(__dirname, 'fixtures', 'packages', 'FlashCap.1.10.0.nupkg');
    const packageDir = path.join(testPackagesDir, 'FlashCap', '1.10.0');
    await fs.mkdir(packageDir, { recursive: true });
    
    // Extract necessary files from the nupkg
    const tempDir = path.join(testBaseDir, 'temp-extract');
    await fs.mkdir(tempDir, { recursive: true });
    
    try {
      // Extract the nupkg to temp directory
      execSync(`unzip -q -o "${sourcePackage}" -d "${tempDir}"`);
      
      // Copy the nupkg file
      await fs.copyFile(sourcePackage, path.join(packageDir, 'FlashCap.1.10.0.nupkg'));
      
      // Copy the nuspec file
      const nuspecSource = path.join(tempDir, 'FlashCap.nuspec');
      if (await fs.access(nuspecSource).then(() => true).catch(() => false)) {
        await fs.copyFile(nuspecSource, path.join(packageDir, 'FlashCap.nuspec'));
      }
      
      // Copy icon file if exists
      const iconSource = path.join(tempDir, 'FlashCap.100.png');
      if (await fs.access(iconSource).then(() => true).catch(() => false)) {
        await fs.copyFile(iconSource, path.join(packageDir, 'icon.png'));
      }
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };

  beforeEach(async (fn) => {
    // Create isolated test directory for each test
    testBaseDir = await createTestDirectory('fastify-ui-api', fn.task.name);
    testConfigDir = testBaseDir;
    testPackagesDir = path.join(testBaseDir, 'packages');
    
    // Create test directories and data
    await fs.mkdir(testPackagesDir, { recursive: true });
    await createTestUsers();
    await setupTestPackage();
    
    // Start server with isolated directories
    serverPort = getTestPort(7000);
  }, 30000);

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  }, 10000);

  // POST /api/ui/config tests
  test('POST /api/ui/config - should return server configuration without authentication (authMode: none)', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - None',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'none'
      };
      
      server = await startFastifyServer(config, logger);

      const response = await fetch(`http://localhost:${serverPort}/api/ui/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('realm');
      expect(data).toHaveProperty('name', 'nuget-server');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('authMode', 'none');
      expect(data).toHaveProperty('authEnabled');
      expect(data.authEnabled).toHaveProperty('general', false);
      expect(data.authEnabled).toHaveProperty('publish', false);
      expect(data.authEnabled).toHaveProperty('admin', false);
      expect(data).toHaveProperty('currentUser', null); // No authentication
    });

  test('POST /api/ui/config - should detect session authentication in config', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Full',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'full'
      };
      
      server = await startFastifyServer(config, logger);

      // First login to get session
      const loginResponse = await fetch(`http://localhost:${serverPort}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'testadminui',
          password: 'adminpass'
        })
      });

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get('set-cookie') || '';
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];
      
      // Use session to access config
      const configResponse = await fetch(`http://localhost:${serverPort}/api/ui/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionToken=${sessionToken}`
        },
        body: JSON.stringify({})
      });

      expect(configResponse.status).toBe(200);
      const data = await configResponse.json();
      expect(data.currentUser).toBeTruthy();
      expect(data.currentUser.username).toBe('testadminui');
      expect(data.currentUser.role).toBe('admin');
      expect(data.currentUser.authenticated).toBe(true);
    });

  test('POST /api/ui/config - should detect Basic authentication in config', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Full',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'full'
      };
      
      server = await startFastifyServer(config, logger);

      // Use Basic authentication to access config
      const credentials = Buffer.from('testadminui:admin-api-key-123').toString('base64');
      const configResponse = await fetch(`http://localhost:${serverPort}/api/ui/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`
        },
        body: JSON.stringify({})
      });

      expect(configResponse.status).toBe(200);
      const data = await configResponse.json();
      expect(data.currentUser).toBeTruthy();
      expect(data.currentUser.username).toBe('testadminui');
      expect(data.currentUser.role).toBe('admin');
      expect(data.currentUser.authenticated).toBe(true);
    });

  test('POST /api/ui/config - should return config without authentication in authMode=full', async () => {
      // Close current server and create new one with authMode=full
      if (server) {
        await server.close();
      }
      
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Full Auth',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'full'
      };
      
      server = await startFastifyServer(config, logger);

      // Access without authentication
      const response = await fetch(`http://localhost:${serverPort}/api/ui/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      // Should succeed without authentication even in authMode=full
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('authMode', 'full');
      expect(data).toHaveProperty('currentUser', null); // Not authenticated
      expect(data).toHaveProperty('serverType', 'fastify');
    });

  test('POST /api/ui/config - should handle browser Accept headers correctly', async () => {
      // Close current server and create new one with authMode=full
      if (server) {
        await server.close();
      }
      
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Full Auth',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'full'
      };
      
      server = await startFastifyServer(config, logger);

      // Simulate browser request with default Accept header
      const response = await fetch(`http://localhost:${serverPort}/api/ui/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*' // Browser default
        },
        body: JSON.stringify({})
      });

      // Should not return 401
      expect(response.status).toBe(200);
      
      // Should not have WWW-Authenticate header
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  // POST /api/ui/users tests
  test('POST /api/ui/users - should require session authentication for user management', async () => {
    server = await startServerWithAuth('publish', serverPort);
      const response = await fetch(`http://localhost:${serverPort}/api/ui/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'list'
        })
      });

      expect(response.status).toBe(401);
    });

  test('POST /api/ui/users - should list users with admin session authentication', async () => {
    server = await startServerWithAuth('publish', serverPort);
    const sessionToken = await loginAndGetSession('testadminui', 'adminpass', serverPort);

    const response = await fetch(`http://localhost:${serverPort}/api/ui/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sessionToken=${sessionToken}`
      },
        body: JSON.stringify({
          action: 'list'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('users');
      expect(Array.isArray(data.users)).toBe(true);
      expect(data.users.length).toBeGreaterThan(0);
      expect(data.users[0]).toHaveProperty('username');
      expect(data.users[0]).toHaveProperty('role');
    });

  test('POST /api/ui/users - should create a new user with admin session authentication', async () => {
    server = await startServerWithAuth('publish', serverPort);
    const sessionToken = await loginAndGetSession('testadminui', 'adminpass', serverPort);

    const response = await fetch(`http://localhost:${serverPort}/api/ui/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sessionToken=${sessionToken}`
      },
        body: JSON.stringify({
          action: 'create',
          username: 'newuser',
          password: 'newpass123',
          role: 'read'
        })
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty('user');
      expect(data).toHaveProperty('apiKey');
      expect(data.user.username).toBe('newuser');
      expect(data.user.role).toBe('read');
      expect(typeof data.apiKey).toBe('string');
      expect(data.apiKey.length).toBeGreaterThan(0);
    });

  test('POST /api/ui/users - should delete a user with admin session authentication', async () => {
    server = await startServerWithAuth('publish', serverPort);
    const sessionToken = await loginAndGetSession('testadminui', 'adminpass', serverPort);

    // First create a user to delete
    await fetch(`http://localhost:${serverPort}/api/ui/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sessionToken=${sessionToken}`
      },
      body: JSON.stringify({
        action: 'create',
        username: 'userToDelete',
        password: 'temp123',
        role: 'read'
      })
    });

    // Then delete the user
    const response = await fetch(`http://localhost:${serverPort}/api/ui/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sessionToken=${sessionToken}`
      },
        body: JSON.stringify({
          action: 'delete',
          username: 'userToDelete'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('message', 'User deleted successfully');
    });

  test('POST /api/ui/users - should reject non-admin user for user management', async () => {
    server = await startServerWithAuth('publish', serverPort);

    // Login as publish user (not admin)
    const publishSessionToken = await loginAndGetSession('testpublishui', 'publishpass', serverPort);

    const response = await fetch(`http://localhost:${serverPort}/api/ui/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sessionToken=${publishSessionToken}`
      },
        body: JSON.stringify({
          action: 'list'
        })
      });

    expect(response.status).toBe(403);
  });

  describe('POST /api/ui/apikey (session required)', () => {
    let sessionToken: string;

    beforeEach(async () => {
      // Generate new port for nested test to avoid conflicts
      serverPort = getTestPort(7200);
      
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Full',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'full'
      };
      
      server = await startFastifyServer(config, logger);
      
      // Login to get session token
      const loginResponse = await fetch(`http://localhost:${serverPort}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'testpublishui',
          password: 'publishpass'
        })
      });

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get('set-cookie') || '';
      sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1] || '';
      expect(sessionToken).toBeTruthy();
    });

    test('should require session authentication for API key regeneration', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/ui/apikey`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(401);
    });

    test('should regenerate API key with session authentication', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/ui/apikey`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionToken=${sessionToken}`
        },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('apiKey');
      expect(data).toHaveProperty('username', 'testpublishui');
      expect(typeof data.apiKey).toBe('string');
      expect(data.apiKey.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/ui/password (session required)', () => {
    let sessionToken: string;
    let adminSessionToken: string;

    beforeEach(async () => {
      // Generate new port for nested test to avoid conflicts
      serverPort = getTestPort(7300);
      
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Full',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'full'
      };
      
      server = await startFastifyServer(config, logger);
      
      // Login as regular user to get session token
      const loginResponse = await fetch(`http://localhost:${serverPort}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'testpublishui',
          password: 'publishpass'
        })
      });

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get('set-cookie') || '';
      sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1] || '';
      expect(sessionToken).toBeTruthy();

      // Also login as admin for admin tests
      const adminLoginResponse = await fetch(`http://localhost:${serverPort}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'testadminui',
          password: 'adminpass'
        })
      });

      expect(adminLoginResponse.status).toBe(200);
      const adminCookies = adminLoginResponse.headers.get('set-cookie') || '';
      adminSessionToken = adminCookies.match(/sessionToken=([^;]+)/)?.[1] || '';
      expect(adminSessionToken).toBeTruthy();
    });

    test('should require session authentication for password change', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/ui/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentPassword: 'publishpass',
          newPassword: 'newpass123'
        })
      });

      expect(response.status).toBe(401);
    });

    test('should change own password with session authentication', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/ui/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionToken=${sessionToken}`
        },
        body: JSON.stringify({
          currentPassword: 'publishpass',
          newPassword: 'newpass123'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('message', 'Password updated successfully');
    });

    test('should reject incorrect current password', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/ui/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionToken=${sessionToken}`
        },
        body: JSON.stringify({
          currentPassword: 'wrongpassword',
          newPassword: 'newpass123'
        })
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'Current password is incorrect');
    });

    test('should allow admin to change other user password', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/ui/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionToken=${adminSessionToken}`
        },
        body: JSON.stringify({
          username: 'testpublishui',
          newPassword: 'adminSetPassword'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('message', 'Password updated successfully');
    });

    test('should reject non-admin user changing other user password', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/ui/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `sessionToken=${sessionToken}`
        },
        body: JSON.stringify({
          username: 'testadminui',
          newPassword: 'hackattempt'
        })
      });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/ui/icon/{id}/{version} (auth based on mode)', () => {
    test('should serve icon without authentication (authMode: none)', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - None',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'none'
      };
      
      server = await startFastifyServer(config, logger);

      const response = await fetch(`http://localhost:${serverPort}/api/ui/icon/FlashCap/1.10.0`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      const buffer = await response.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    test('should serve icon without authentication (authMode: publish)', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Publish',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'publish'
      };
      
      server = await startFastifyServer(config, logger);

      const response = await fetch(`http://localhost:${serverPort}/api/ui/icon/FlashCap/1.10.0`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
    });

    test('should require authentication for icon (authMode: full)', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Full',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'full'
      };
      
      server = await startFastifyServer(config, logger);

      // Without authentication
      const response = await fetch(`http://localhost:${serverPort}/api/ui/icon/FlashCap/1.10.0`);
      expect(response.status).toBe(401);

      // With session authentication
      const loginResponse = await fetch(`http://localhost:${serverPort}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'testadminui',
          password: 'adminpass'
        })
      });

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get('set-cookie') || '';
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];

      const authResponse = await fetch(`http://localhost:${serverPort}/api/ui/icon/FlashCap/1.10.0`, {
        headers: {
          'Cookie': `sessionToken=${sessionToken}`
        }
      });

      expect(authResponse.status).toBe(200);
      expect(authResponse.headers.get('content-type')).toBe('image/png');
    });

    test('should return 404 for non-existent icon', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - None',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'none'
      };
      
      server = await startFastifyServer(config, logger);

      const response = await fetch(`http://localhost:${serverPort}/api/ui/icon/nonexistent/1.0.0`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/publish (hybrid auth based on mode)', () => {
    test('should allow publish without authentication (authMode: none)', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - None',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'none'
      };
      
      server = await startFastifyServer(config, logger);

      // Use a fixture package for testing
      const fixturePackagePath = path.join(__dirname, 'fixtures', 'packages', 'GitReader.1.15.0.nupkg');
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      const response = await fetch(`http://localhost:${serverPort}/api/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: new Uint8Array(testPackageBuffer)
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty('message', 'Package uploaded successfully');
      expect(data).toHaveProperty('id', 'GitReader');
      expect(data).toHaveProperty('version', '1.15.0');
    });

    test('should require authentication for publish (authMode: publish)', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Publish',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'publish'
      };
      
      server = await startFastifyServer(config, logger);

      // Use a fixture package for testing
      const fixturePackagePath = path.join(__dirname, 'fixtures', 'packages', 'GitReader.1.15.0.nupkg');
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      // Without authentication
      const response = await fetch(`http://localhost:${serverPort}/api/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: new Uint8Array(testPackageBuffer)
      });

      expect(response.status).toBe(401);
    });

    test('should allow publish with session authentication (authMode: publish)', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Publish',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'publish'
      };
      
      server = await startFastifyServer(config, logger);

      // Login to get session
      const loginResponse = await fetch(`http://localhost:${serverPort}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'testpublishui',
          password: 'publishpass'
        })
      });

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get('set-cookie') || '';
      const sessionToken = cookies.match(/sessionToken=([^;]+)/)?.[1];

      // Use a fixture package for testing
      const fixturePackagePath = path.join(__dirname, 'fixtures', 'packages', 'GitReader.1.15.0.nupkg');
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      const response = await fetch(`http://localhost:${serverPort}/api/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cookie': `sessionToken=${sessionToken}`
        },
        body: new Uint8Array(testPackageBuffer)
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty('message', 'Package uploaded successfully');
      expect(data).toHaveProperty('id', 'GitReader');
      expect(data).toHaveProperty('version', '1.15.0');
    });

    test('should allow publish with Basic authentication (authMode: publish)', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Publish',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'publish'
      };
      
      server = await startFastifyServer(config, logger);

      // Use a fixture package for testing
      const fixturePackagePath = path.join(__dirname, 'fixtures', 'packages', 'GitReader.1.15.0.nupkg');
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      // Use Basic authentication
      const credentials = Buffer.from('testpublishui:publish-api-key-123').toString('base64');
      const response = await fetch(`http://localhost:${serverPort}/api/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Basic ${credentials}`
        },
        body: new Uint8Array(testPackageBuffer)
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty('message', 'Package uploaded successfully');
      expect(data).toHaveProperty('id', 'GitReader');
      expect(data).toHaveProperty('version', '1.15.0');
    });

    test('should reject read-only user for publish', async () => {
      const config: ServerConfig = {
        port: serverPort,
        packageDir: testPackagesDir,
        configDir: testConfigDir,
        realm: 'Test Fastify UI Server - Publish',
        logLevel: testGlobalLogLevel,
        noUi: false,
        authMode: 'publish'
      };
      
      server = await startFastifyServer(config, logger);

      // Use a fixture package for testing
      const fixturePackagePath = path.join(__dirname, 'fixtures', 'packages', 'GitReader.1.15.0.nupkg');
      const testPackageBuffer = await fs.readFile(fixturePackagePath);

      // Use Basic authentication with read user
      const credentials = Buffer.from('testreadui:read-api-key-123').toString('base64');
      const response = await fetch(`http://localhost:${serverPort}/api/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Basic ${credentials}`
        },
        body: new Uint8Array(testPackageBuffer)
      });

      expect(response.status).toBe(403);
    });
  });
});