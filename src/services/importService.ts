// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { access } from 'fs/promises';
import { constants } from 'fs';
import AdmZip from 'adm-zip';
import xml2js from 'xml2js';
import { createNuGetClient } from './nugetClient';
import { Logger } from '../types';
import { readNuspecIdentity } from '../utils/nuspec.ts';
import { packageArchivePath, savePackageFiles } from './packageStorage.ts';

/**
 * Package information for import
 */
export interface PackageToImport {
  id: string;
  versions: string[];
}

/**
 * Import progress information
 */
export interface ImportProgress {
  totalPackages: number;
  totalVersions: number;
  downloadedVersions: number;
  failedVersions: number;
  currentPackage?: string;
  currentVersion?: string;
}

/**
 * Import service configuration
 */
export interface ImportServiceConfig {
  sourceUrl: string;
  /** Maximum decoded bytes per upstream response. */
  maxResponseBytes?: number;
  username?: string;
  password?: string;
  packageDir: string;
  logger: Logger;
  onProgress?: (progress: ImportProgress) => void;
}

/**
 * Import result summary
 */
export interface ImportResult {
  totalPackages: number;
  totalVersions: number;
  successfulVersions: number;
  failedVersions: number;
  failures: Array<{
    packageId: string;
    version: string;
    error: string;
  }>;
}

/**
 * Service for importing packages from remote NuGet servers
 */
export interface ImportService {
  discoverPackages: () => Promise<PackageToImport[]>;
  importPackages: (packages: PackageToImport[]) => Promise<ImportResult>;
}

/**
 * Parse nuspec XML to extract package metadata
 */
const parseNuspec = async (
  nuspecContent: string
): Promise<{
  id: string;
  version: string;
  icon?: string;
}> => {
  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(nuspecContent);

  const metadata = result.package?.metadata;
  if (!metadata) {
    throw new Error('Invalid nuspec: missing metadata');
  }

  return {
    ...readNuspecIdentity(metadata.id, metadata.version),
    icon: metadata.icon,
  };
};

/**
 * Check if a package version already exists
 */
const packageExists = async (
  packageDir: string,
  packageId: string,
  version: string
): Promise<boolean> => {
  const packagePath = packageArchivePath(packageDir, packageId, version);

  try {
    await access(packagePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * NuGet feeds omit build metadata, leading zeroes, and a zero revision in their version lists.
 */
const feedVersionKey = (version: string): string =>
  version
    .toLowerCase()
    .replace(/\+.*$/, '')
    .replace(/^[\d.]+/, (core) => {
      const parts = core.split('.').map(Number);
      if (parts[3] === 0) parts.pop();
      while (parts.length < 3) parts.push(0);
      return parts.join('.');
    });

/**
 * Save a package to disk
 */
const savePackage = async (
  packageData: Buffer,
  packageDir: string,
  requested: { id: string; version: string },
  logger: Logger
): Promise<void> => {
  // Validate package format
  let zip: AdmZip;
  try {
    zip = new AdmZip(packageData);
  } catch (error) {
    throw new Error('Invalid package format - not a valid ZIP file');
  }

  // Extract nuspec
  const nuspecEntry = zip
    .getEntries()
    .find((entry) => entry.entryName.endsWith('.nuspec'));

  if (!nuspecEntry) {
    throw new Error('Package does not contain a .nuspec file');
  }

  const nuspecContent = nuspecEntry.getData().toString('utf8');
  const metadata = await parseNuspec(nuspecContent);
  if (
    metadata.id.toLowerCase() !== requested.id.toLowerCase() ||
    feedVersionKey(metadata.version) !== feedVersionKey(requested.version)
  ) {
    throw new Error(
      'Downloaded package identity does not match the requested ID and version'
    );
  }

  // Save the archive, its nuspec, and any supported icon to the validated directory.
  await savePackageFiles(
    packageDir,
    metadata,
    { archive: packageData, nuspec: nuspecContent, zip, icon: metadata.icon },
    true,
    logger
  );
};

/**
 * Creates an import service for transferring packages between NuGet servers
 * @param config - Import service configuration
 * @returns Import service instance
 */
export const createImportService = (
  config: ImportServiceConfig
): ImportService => {
  const { sourceUrl, username, password, packageDir, logger, onProgress } =
    config;

  const client = createNuGetClient({
    baseUrl: sourceUrl,
    maxResponseBytes: config.maxResponseBytes,
    username,
    password,
  });

  return {
    /**
     * Discover all packages from the source server
     */
    discoverPackages: async (): Promise<PackageToImport[]> => {
      logger.info('Fetching service index...');
      const serviceIndex = await client.getServiceIndex();

      // Find required service URLs
      const searchService = serviceIndex.resources.find((r) => {
        const types = Array.isArray(r['@type']) ? r['@type'] : [r['@type']];
        return types.some((t) => t.includes('SearchQueryService'));
      });

      const packageBaseService = serviceIndex.resources.find((r) => {
        const types = Array.isArray(r['@type']) ? r['@type'] : [r['@type']];
        return types.some((t) => t.includes('PackageBaseAddress'));
      });

      if (!searchService || !packageBaseService) {
        throw new Error('Required NuGet services not found in service index');
      }

      const searchUrl = searchService['@id'].replace(/\/$/, '');
      const packageBaseUrl = packageBaseService['@id'].replace(/\/$/, '');

      logger.info('Discovering packages...');

      // Search for all packages
      const allPackages: PackageToImport[] = [];
      let skip = 0;
      const take = 100;
      let totalHits = 0;

      do {
        logger.debug(`Fetching packages ${skip} to ${skip + take}...`);
        const searchResult = await client.searchPackages(searchUrl, skip, take);
        totalHits = searchResult.totalHits;

        for (const pkg of searchResult.data) {
          try {
            logger.debug(`Getting versions for ${pkg.id}...`);
            const versions = await client.getPackageVersions(
              packageBaseUrl,
              pkg.id
            );
            allPackages.push({
              id: pkg.id,
              versions,
            });
          } catch (error) {
            logger.warn(`Failed to get versions for ${pkg.id}: ${error}`);
          }
        }

        skip += take;
      } while (skip < totalHits);

      const totalVersions = allPackages.reduce(
        (sum, p) => sum + p.versions.length,
        0
      );
      logger.info(
        `Found ${allPackages.length} packages with ${totalVersions} total versions`
      );

      return allPackages;
    },

    /**
     * Import packages from the source server
     */
    importPackages: async (
      packages: PackageToImport[]
    ): Promise<ImportResult> => {
      const serviceIndex = await client.getServiceIndex();

      const packageContentService = serviceIndex.resources.find((r) => {
        const types = Array.isArray(r['@type']) ? r['@type'] : [r['@type']];
        return types.some((t) => t.includes('PackageBaseAddress'));
      });

      if (!packageContentService) {
        throw new Error('Package content service not found');
      }

      const packageContentUrl = packageContentService['@id'].replace(/\/$/, '');

      const result: ImportResult = {
        totalPackages: packages.length,
        totalVersions: packages.reduce((sum, p) => sum + p.versions.length, 0),
        successfulVersions: 0,
        failedVersions: 0,
        failures: [],
      };

      const progress: ImportProgress = {
        totalPackages: result.totalPackages,
        totalVersions: result.totalVersions,
        downloadedVersions: 0,
        failedVersions: 0,
      };

      // Import packages sequentially
      for (const pkg of packages) {
        for (const version of pkg.versions) {
          progress.currentPackage = pkg.id;
          progress.currentVersion = version;

          try {
            // Check if already exists
            let overwrite = false;
            if (await packageExists(packageDir, pkg.id, version)) {
              logger.debug(
                `Overwriting existing package: ${pkg.id}@${version}`
              );
              overwrite = true;
            }

            logger.debug(`Downloading ${pkg.id}@${version}...`);

            // Download package
            const packageData = await client.downloadPackage(
              packageContentUrl,
              pkg.id,
              version
            );

            // Save to disk
            await savePackage(
              packageData,
              packageDir,
              { id: pkg.id, version },
              logger
            );

            result.successfulVersions++;
            progress.downloadedVersions++;

            logger.info(
              `Successfully imported ${pkg.id}@${version}${overwrite ? ' (overwrite)' : ''}`
            );
          } catch (error: any) {
            logger.error(
              `Failed to import ${pkg.id}@${version}: ${error.message}`
            );
            result.failedVersions++;
            progress.failedVersions++;
            result.failures.push({
              packageId: pkg.id,
              version,
              error: error.message,
            });
          }

          // Report progress
          if (onProgress) {
            onProgress(progress);
          }
        }
      }

      return result;
    },
  };
};
