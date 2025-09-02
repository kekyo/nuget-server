// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdir, rm } from 'fs/promises';
import dayjs from 'dayjs';
import { createImportService } from '../src/services/importService';
import { createTestDirectory, getTestPort } from './helpers/test-helper';

// Mock nugetClient module
vi.mock('../src/services/nugetClient', () => {
  const mockClient = {
    getServiceIndex: vi.fn(),
    searchPackages: vi.fn(),
    getPackageVersions: vi.fn(),
    downloadPackage: vi.fn(),
  };

  return {
    createNuGetClient: vi.fn(() => mockClient),
  };
});

describe('ImportService', () => {
  let testDir: string;
  let mockLogger: any;
  let mockClient: any;

  beforeEach(async () => {
    testDir = await createTestDirectory('import-service', 'import-test');

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Get mocked client
    const { createNuGetClient } = await import('../src/services/nugetClient');
    mockClient = (createNuGetClient as any)();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe('discoverPackages', () => {
    it('should discover all packages from source server', async () => {
      // Mock service index
      mockClient.getServiceIndex.mockResolvedValueOnce({
        version: '3.0.0',
        resources: [
          {
            '@id': 'https://api.test.com/search',
            '@type': 'SearchQueryService',
          },
          {
            '@id': 'https://api.test.com/package',
            '@type': 'PackageBaseAddress/3.0.0',
          },
        ],
      });

      // Mock search results
      mockClient.searchPackages.mockResolvedValueOnce({
        totalHits: 2,
        data: [
          { id: 'Package1', version: '1.0.0', versions: [] },
          { id: 'Package2', version: '2.0.0', versions: [] },
        ],
      });

      // Mock package versions
      mockClient.getPackageVersions
        .mockResolvedValueOnce(['1.0.0', '1.1.0'])
        .mockResolvedValueOnce(['2.0.0', '2.1.0']);

      const service = createImportService({
        sourceUrl: 'https://api.test.com',
        packageDir: testDir,
        logger: mockLogger,
      });

      const packages = await service.discoverPackages();

      expect(packages).toHaveLength(2);
      expect(packages[0]).toEqual({
        id: 'Package1',
        versions: ['1.0.0', '1.1.0'],
      });
      expect(packages[1]).toEqual({
        id: 'Package2',
        versions: ['2.0.0', '2.1.0'],
      });
    });

    it('should handle pagination in package discovery', async () => {
      mockClient.getServiceIndex.mockResolvedValueOnce({
        version: '3.0.0',
        resources: [
          {
            '@id': 'https://api.test.com/search',
            '@type': ['SearchQueryService'],
          },
          {
            '@id': 'https://api.test.com/package',
            '@type': ['PackageBaseAddress/3.0.0'],
          },
        ],
      });

      // First page
      mockClient.searchPackages.mockResolvedValueOnce({
        totalHits: 150,
        data: Array(100)
          .fill(null)
          .map((_, i) => ({
            id: `Package${i}`,
            version: '1.0.0',
            versions: [],
          })),
      });

      // Second page
      mockClient.searchPackages.mockResolvedValueOnce({
        totalHits: 150,
        data: Array(50)
          .fill(null)
          .map((_, i) => ({
            id: `Package${i + 100}`,
            version: '1.0.0',
            versions: [],
          })),
      });

      // Mock versions for all packages
      for (let i = 0; i < 150; i++) {
        mockClient.getPackageVersions.mockResolvedValueOnce(['1.0.0']);
      }

      const service = createImportService({
        sourceUrl: 'https://api.test.com',
        packageDir: testDir,
        logger: mockLogger,
      });

      const packages = await service.discoverPackages();

      expect(packages).toHaveLength(150);
      expect(mockClient.searchPackages).toHaveBeenCalledTimes(2);
    });

    it('should handle errors when getting package versions', async () => {
      mockClient.getServiceIndex.mockResolvedValueOnce({
        version: '3.0.0',
        resources: [
          {
            '@id': 'https://api.test.com/search',
            '@type': 'SearchQueryService',
          },
          {
            '@id': 'https://api.test.com/package',
            '@type': 'PackageBaseAddress/3.0.0',
          },
        ],
      });

      mockClient.searchPackages.mockResolvedValueOnce({
        totalHits: 2,
        data: [
          { id: 'Package1', version: '1.0.0', versions: [] },
          { id: 'Package2', version: '2.0.0', versions: [] },
        ],
      });

      // First package succeeds, second fails
      mockClient.getPackageVersions
        .mockResolvedValueOnce(['1.0.0'])
        .mockRejectedValueOnce(new Error('Network error'));

      const service = createImportService({
        sourceUrl: 'https://api.test.com',
        packageDir: testDir,
        logger: mockLogger,
      });

      const packages = await service.discoverPackages();

      expect(packages).toHaveLength(1);
      expect(packages[0].id).toBe('Package1');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get versions for Package2')
      );
    });
  });

  describe('importPackages', () => {
    it('should import packages successfully', async () => {
      // Create a mock .nupkg file (ZIP with nuspec)
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip();

      const nuspecContent = `<?xml version="1.0"?>
<package>
  <metadata>
    <id>TestPackage</id>
    <version>1.0.0</version>
  </metadata>
</package>`;

      zip.addFile('TestPackage.nuspec', Buffer.from(nuspecContent));
      const packageBuffer = zip.toBuffer();

      mockClient.getServiceIndex.mockResolvedValueOnce({
        version: '3.0.0',
        resources: [
          {
            '@id': 'https://api.test.com/package',
            '@type': 'PackageBaseAddress/3.0.0',
          },
        ],
      });

      mockClient.downloadPackage.mockResolvedValueOnce(packageBuffer);

      const service = createImportService({
        sourceUrl: 'https://api.test.com',
        packageDir: testDir,
        logger: mockLogger,
      });

      const packages = [
        {
          id: 'TestPackage',
          versions: ['1.0.0'],
        },
      ];

      const result = await service.importPackages(packages);

      expect(result.totalPackages).toBe(1);
      expect(result.totalVersions).toBe(1);
      expect(result.successfulVersions).toBe(1);
      expect(result.failedVersions).toBe(0);
      expect(result.failures).toHaveLength(0);
    });

    it('should handle package download failures', async () => {
      mockClient.getServiceIndex.mockResolvedValueOnce({
        version: '3.0.0',
        resources: [
          {
            '@id': 'https://api.test.com/package',
            '@type': 'PackageBaseAddress/3.0.0',
          },
        ],
      });

      mockClient.downloadPackage.mockRejectedValueOnce(
        new Error('Download failed')
      );

      const service = createImportService({
        sourceUrl: 'https://api.test.com',
        packageDir: testDir,
        logger: mockLogger,
      });

      const packages = [
        {
          id: 'TestPackage',
          versions: ['1.0.0'],
        },
      ];

      const result = await service.importPackages(packages);

      expect(result.totalPackages).toBe(1);
      expect(result.totalVersions).toBe(1);
      expect(result.successfulVersions).toBe(0);
      expect(result.failedVersions).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toEqual({
        packageId: 'TestPackage',
        version: '1.0.0',
        error: 'Download failed',
      });
    });

    it('should report progress during import', async () => {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip();

      const nuspecContent = `<?xml version="1.0"?>
<package>
  <metadata>
    <id>TestPackage</id>
    <version>1.0.0</version>
  </metadata>
</package>`;

      zip.addFile('TestPackage.nuspec', Buffer.from(nuspecContent));
      const packageBuffer = zip.toBuffer();

      mockClient.getServiceIndex.mockResolvedValueOnce({
        version: '3.0.0',
        resources: [
          {
            '@id': 'https://api.test.com/package',
            '@type': 'PackageBaseAddress/3.0.0',
          },
        ],
      });

      mockClient.downloadPackage.mockResolvedValue(packageBuffer);

      const progressReports: any[] = [];
      const onProgress = vi.fn((progress) => {
        progressReports.push({ ...progress });
      });

      const service = createImportService({
        sourceUrl: 'https://api.test.com',
        packageDir: testDir,
        logger: mockLogger,
        onProgress,
      });

      const packages = [
        {
          id: 'Package1',
          versions: ['1.0.0', '1.1.0'],
        },
        {
          id: 'Package2',
          versions: ['2.0.0'],
        },
      ];

      await service.importPackages(packages);

      expect(onProgress).toHaveBeenCalled();
      expect(progressReports.length).toBeGreaterThan(0);

      const lastProgress = progressReports[progressReports.length - 1];
      expect(lastProgress.totalPackages).toBe(2);
      expect(lastProgress.totalVersions).toBe(3);
      expect(lastProgress.downloadedVersions).toBe(3);
    });

    it('should extract icon from package if present', async () => {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip();

      const nuspecContent = `<?xml version="1.0"?>
<package>
  <metadata>
    <id>TestPackage</id>
    <version>1.0.0</version>
    <icon>icon.png</icon>
  </metadata>
</package>`;

      zip.addFile('TestPackage.nuspec', Buffer.from(nuspecContent));
      zip.addFile('icon.png', Buffer.from('fake-icon-data'));
      const packageBuffer = zip.toBuffer();

      mockClient.getServiceIndex.mockResolvedValueOnce({
        version: '3.0.0',
        resources: [
          {
            '@id': 'https://api.test.com/package',
            '@type': 'PackageBaseAddress/3.0.0',
          },
        ],
      });

      mockClient.downloadPackage.mockResolvedValueOnce(packageBuffer);

      const service = createImportService({
        sourceUrl: 'https://api.test.com',
        packageDir: testDir,
        logger: mockLogger,
      });

      const packages = [
        {
          id: 'TestPackage',
          versions: ['1.0.0'],
        },
      ];

      const result = await service.importPackages(packages);

      expect(result.successfulVersions).toBe(1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Extracted icon')
      );
    });
  });
});
