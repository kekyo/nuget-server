import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startServer, ServerInstance } from './helpers/server.js';
import { createTestDirectory, setupPackageStorage } from './helpers/package.js';
import { createConsoleLogger } from '../src/logger.js';

describe('SearchQueryService API', () => {
  let serverInstance: ServerInstance | null = null;
  let serverPort: number;
  let testBaseDir: string;
  let baseUrl: string;
  const logger = createConsoleLogger('SearchTest');

  beforeEach(async fn => {
    // Create test directory with timestamp
    testBaseDir = await createTestDirectory(fn.task.name);
    serverPort = 3001 + Math.floor(Math.random() * 1000);
    
    // Setup package storage with fixture packages
    await setupPackageStorage(testBaseDir);
    
    // Start server with test directory
    serverInstance = await startServer(serverPort, testBaseDir);
    baseUrl = `http://localhost:${serverPort}`;
  });

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.stop();
      serverInstance = null;
    }
  });

  it('should be included in service index', async () => {
    const response = await fetch(`${baseUrl}/api/index.json`);
    expect(response.status).toBe(200);

    const serviceIndex = await response.json();
    expect(serviceIndex.resources).toBeDefined();

    const searchService = serviceIndex.resources.find((r: any) => 
      r['@type'] === 'SearchQueryService/3.0.0'
    );

    expect(searchService).toBeDefined();
    expect(searchService['@id']).toBe(`${baseUrl}/api/search`);
    expect(searchService.comment).toBe('Query endpoint of NuGet Search service');
  });

  it('should return all packages without query parameters', async () => {
    const response = await fetch(`${baseUrl}/api/search`);
    expect(response.status).toBe(200);

    const searchResponse = await response.json();
    
    // Check response structure
    expect(searchResponse['@context']).toBeDefined();
    expect(searchResponse.totalHits).toBe(4); // 4 packages from fixtures
    expect(searchResponse.data).toBeInstanceOf(Array);
    expect(searchResponse.lastReopen).toBeDefined();
    expect(searchResponse.index).toBe('v3-lucene0');

    // Check that we have fixture packages
    const flashCapPackage = searchResponse.data.find((p: any) => p.id === 'FlashCap');
    expect(flashCapPackage).toBeDefined();
    expect(flashCapPackage.versions).toHaveLength(2);
    expect(flashCapPackage.versions.map((v: any) => v.version)).toContain('1.10.0');
    expect(flashCapPackage.versions.map((v: any) => v.version)).toContain('1.11.0');

    const gitReaderPackage = searchResponse.data.find((p: any) => p.id === 'GitReader');
    expect(gitReaderPackage).toBeDefined();
    expect(gitReaderPackage.versions).toHaveLength(2);
    expect(gitReaderPackage.versions.map((v: any) => v.version)).toContain('1.15.0');
    expect(gitReaderPackage.versions.map((v: any) => v.version)).toContain('1.16.0');
  });

  it('should ignore query parameters and return all packages', async () => {
    const response = await fetch(`${baseUrl}/api/search?q=nonexistent&skip=100&take=1`);
    expect(response.status).toBe(200);

    const searchResponse = await response.json();
    
    // Should still return all packages despite parameters
    expect(searchResponse.totalHits).toBe(4);
    expect(searchResponse.data.length).toBe(4);
  });

  it('should return correct package metadata structure', async () => {
    const response = await fetch(`${baseUrl}/api/search`);
    expect(response.status).toBe(200);

    const searchResponse = await response.json();
    const flashCapPackage = searchResponse.data.find((p: any) => p.id === 'FlashCap');

    // Check package structure
    expect(flashCapPackage['@type']).toBe('Package');
    expect(flashCapPackage.registration).toBe(`${baseUrl}/api/registrations/flashcap/index.json`);
    expect(flashCapPackage.id).toBe('FlashCap');
    expect(flashCapPackage.version).toBe('1.11.0'); // Latest version
    expect(flashCapPackage.description).toBeDefined();
    expect(flashCapPackage.title).toBe('FlashCap');
    expect(flashCapPackage.authors).toBeDefined();
    expect(flashCapPackage.totalDownloads).toBe(0);
    expect(flashCapPackage.verified).toBe(false);
    expect(flashCapPackage.packageTypes).toEqual([{ name: 'Dependency' }]);

    // Check version structure
    expect(flashCapPackage.versions).toHaveLength(2);
    const version = flashCapPackage.versions[0];
    expect(version.version).toBeDefined();
    expect(version.downloads).toBe(0);
    expect(version['@id']).toMatch(/\/registrations\/flashcap\/.+\.json$/);
  });

  it('should handle empty packages gracefully', async () => {
    // Create empty test directory
    const emptyTestDir = await createTestDirectory('empty-packages-test');
    const emptyPort = serverPort + 100; // Use different port
    
    const emptyServer = await startServer(emptyPort, emptyTestDir);

    try {
      const response = await fetch(`http://localhost:${emptyPort}/api/search`);
      expect(response.status).toBe(200);

      const searchResponse = await response.json();
      expect(searchResponse.totalHits).toBe(0);
      expect(searchResponse.data).toEqual([]);
    } finally {
      await emptyServer.stop();
    }
  });
});