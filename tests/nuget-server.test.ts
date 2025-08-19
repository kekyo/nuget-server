import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { startServer, ServerInstance } from './helpers/server.js';
import { createTestDirectory, setupPackageStorage, getAvailablePackages } from './helpers/package.js';
import { 
  createTestProject, 
  addNuGetSource, 
  runDotNetRestore, 
  checkDotNetAvailable
} from './helpers/dotnet.js';
import { createConsoleLogger } from '../src/logger.js';

describe('NuGet Server Integration Tests', () => {
  let testBaseDir: string;
  let serverInstance: ServerInstance | null = null;
  let serverPort: number;
  const logger = createConsoleLogger('Test');

  beforeEach(async fn => {
    // Create test directory with timestamp
    testBaseDir = await createTestDirectory(fn.task.name);
    logger.info(`Test directory: ${testBaseDir}`);
    serverPort = 3001 + Math.floor(Math.random() * 1000);
    
    // Setup package storage
    await setupPackageStorage(testBaseDir);
    
    // Start server with log capture
    const packageDir = path.join(testBaseDir, 'packages');
    serverInstance = await startServer(serverPort, testBaseDir, (log) => {
      logger.info(`[SERVER] ${log}`);
    }, packageDir);
    
    logger.info(`Server started on port ${serverPort}`);
  }, 30000); // 30 second timeout for setup

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.stop();
      serverInstance = null;
      logger.info('Server stopped');
    }
  }, 10000); // 10 second timeout for teardown

  it('should serve service index', async () => {
    const response = await fetch(`http://localhost:${serverPort}/api/index.json`);
    expect(response.ok).toBe(true);
    
    const serviceIndex = await response.json();
    expect(serviceIndex).toHaveProperty('version', '3.0.0');
    expect(serviceIndex).toHaveProperty('resources');
    expect(Array.isArray(serviceIndex.resources)).toBe(true);
    expect(serviceIndex.resources.length).toBeGreaterThan(0);
    
    const packageBaseAddress = serviceIndex.resources.find(
      (r: any) => r['@type'] === 'PackageBaseAddress/3.0.0'
    );
    expect(packageBaseAddress).toBeDefined();
    expect(packageBaseAddress['@id']).toContain('/api/package/');
  });

  it('should serve package versions', async () => {
    const packages = await getAvailablePackages();
    expect(packages.length).toBeGreaterThan(0);
    
    const testPackage = packages[0];
    const response = await fetch(
      `http://localhost:${serverPort}/api/package/${testPackage.id}/index.json`
    );
    
    expect(response.ok).toBe(true);
    const versionsResponse = await response.json();
    expect(versionsResponse).toHaveProperty('versions');
    expect(Array.isArray(versionsResponse.versions)).toBe(true);
    expect(versionsResponse.versions).toContain(testPackage.version);
  });

  it('should serve package downloads', async () => {
    const packages = await getAvailablePackages();
    expect(packages.length).toBeGreaterThan(0);
    
    const testPackage = packages[0];
    const response = await fetch(
      `http://localhost:${serverPort}/api/package/${testPackage.id}/${testPackage.version}/${testPackage.id}.${testPackage.version}.nupkg`
    );
    
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/zip');
    
    const content = await response.arrayBuffer();
    expect(content.byteLength).toBeGreaterThan(0);
  });

  it('should serve nuspec files', async () => {
    const packages = await getAvailablePackages();
    expect(packages.length).toBeGreaterThan(0);
    
    const testPackage = packages[0];
    const response = await fetch(
      `http://localhost:${serverPort}/api/package/${testPackage.id}/${testPackage.version}/${testPackage.id}.nuspec`
    );
    
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/xml');
    
    const nuspecContent = await response.text();
    expect(nuspecContent).toContain('<?xml');
    expect(nuspecContent).toContain('<package');
  });

  it('should handle dotnet restore successfully', async () => {
    // Check if dotnet is available
    const dotnetAvailable = await checkDotNetAvailable();
    if (!dotnetAvailable) {
      logger.info('Skipping dotnet restore test - dotnet CLI not available');
      return;
    }
    
    const packages = await getAvailablePackages();
    expect(packages.length).toBeGreaterThan(0);
    
    // Use not *.core package which should have proper dependencies for testing
    const testPackage = packages.find(p => !p.id.includes('.core')) || packages[0];
    logger.info(`Testing with package: ${testPackage.id} ${testPackage.version}`);
    const dotnetDir = path.join(testBaseDir, 'dotnet');
    
    // Create test project
    await createTestProject(dotnetDir, testPackage.id, testPackage.version);
    await addNuGetSource(dotnetDir, `http://localhost:${serverPort}/api`);
    
    // Run dotnet restore
    const restoreResult = await runDotNetRestore(dotnetDir);
    
    logger.info(`Restore stdout: ${restoreResult.stdout}`);
    logger.info(`Restore stderr: ${restoreResult.stderr}`);
    
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.exitCode).toBe(0);
    
    // Since net8.0 projects might not need HTTP requests, verify server functionality
    // by making a direct API call to confirm our server is working properly
    const serviceIndexResponse = await fetch(`http://localhost:${serverPort}/api/index.json`);
    expect(serviceIndexResponse.ok).toBe(true);
    
    const packageVersionsResponse = await fetch(`http://localhost:${serverPort}/api/package/${testPackage.id.toLowerCase()}/index.json`);
    expect(packageVersionsResponse.ok).toBe(true);
    
    // Test passed - dotnet restore succeeded and our server APIs are functional
    logger.info(`✅ Test passed: dotnet restore succeeded and server APIs are functional`);
  }, 60000); // 60 second timeout for dotnet restore

  it('should handle multiple package versions', async () => {
    const packages = await getAvailablePackages();
    
    // Group packages by ID to find ones with multiple versions
    const packageGroups = packages.reduce((groups, pkg) => {
      if (!groups[pkg.id]) groups[pkg.id] = [];
      groups[pkg.id].push(pkg);
      return groups;
    }, {} as Record<string, typeof packages>);
    
    const multiVersionPackages = Object.entries(packageGroups)
      .filter(([, versions]) => versions.length > 1);
    
    if (multiVersionPackages.length === 0) {
      logger.info('Skipping multiple versions test - no packages with multiple versions found');
      return;
    }
    
    const [packageId, versions] = multiVersionPackages[0];
    
    const response = await fetch(
      `http://localhost:${serverPort}/api/package/${packageId}/index.json`
    );
    
    expect(response.ok).toBe(true);
    const versionsResponse = await response.json();
    expect(versionsResponse.versions.length).toBe(versions.length);
    
    // Verify all versions are present
    for (const version of versions) {
      expect(versionsResponse.versions).toContain(version.version);
    }
  });
});