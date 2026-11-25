// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import fs from 'fs/promises';
import path from 'path';
import xml2js from 'xml2js';
import { createReaderWriterLock } from 'async-primitives';
import type { Logger, DuplicatePackagePolicy } from '../types.ts';
import { compareVersions } from '../utils/semver.ts';
import {
  extractNuspecTargetFrameworks,
  parseNuspecTags,
  readNuspecIdentity,
} from '../utils/nuspec.ts';

/**
 * Group of package dependencies for a specific target framework
 */
export interface DependencyGroup {
  targetFramework?: string;
  dependencies: PackageDependency[];
}

/**
 * Individual package dependency specification
 */
export interface PackageDependency {
  id: string;
  version?: string;
  exclude?: string;
}

/**
 * Complete metadata information for a package version
 */
export interface PackageMetadata {
  id: string;
  version: string;
  authors?: string;
  description?: string;
  licenseUrl?: string;
  licenseExpression?: string;
  projectUrl?: string;
  iconUrl?: string;
  icon?: string;
  tags?: string[];
  targetFrameworks?: string[];
  dependencies?: DependencyGroup[];
  published: Date;
  listed: boolean;
  packageContentUrl: string;
}

/**
 * Storage information for package files on disk
 */
export interface PackageStorage {
  dirName: string; // Actual directory name (e.g., "FlashCap")
  versionDirName: string; // Version spelling used on disk
  fileName: string; // Actual nupkg file name (e.g., "FlashCap.1.10.0.nupkg")
  nuspecName: string; // Actual nuspec file name (e.g., "FlashCap.nuspec")
}

/**
 * Combined package metadata and storage information
 */
export interface PackageEntry {
  metadata: PackageMetadata;
  storage: PackageStorage;
}

/**
 * Service interface for managing package metadata and caching
 */
export interface MetadataService {
  readonly initialize: () => Promise<void>;
  readonly getPackageMetadata: (packageId: string) => PackageMetadata[];
  readonly getPackageVersion: (
    packageId: string,
    version: string
  ) => PackageMetadata | undefined;
  readonly getPackageEntry: (
    packageId: string,
    version: string
  ) => PackageEntry | undefined;
  readonly getAllPackageIds: () => string[];
  readonly getLatestPackageEntry: (
    packageId: string
  ) => PackageEntry | undefined;
  readonly updateBaseUrl: (baseUrl: string) => Promise<void>;
  readonly addPackage: (
    metadata: PackageMetadata,
    policy?: DuplicatePackagePolicy,
    saveFiles?: (id: string, version: string) => Promise<boolean>
  ) => Promise<{
    action: 'added' | 'overwritten' | 'ignored' | 'error';
    message?: string;
  }>;
  readonly addPackageEntry: (entry: PackageEntry) => Promise<void>;
}

/**
 * Creates a metadata service instance for managing package information
 * @param packagesRoot - Root directory containing package files (default: './packages')
 * @param baseUrl - Base URL for generating package URLs (default: '')
 * @param logger - Logger instance for service events
 * @returns Configured metadata service instance
 */
export const createMetadataService = (
  packagesRoot: string = './packages',
  baseUrl: string = '',
  logger: Logger
): MetadataService => {
  const packagesCache = new Map<string, PackageEntry[]>();
  let currentBaseUrl = baseUrl;
  const cacheLock = createReaderWriterLock();

  /**
   * Extracts dependency groups from parsed XML metadata
   * @param deps - Raw dependency data from XML parser
   * @returns Array of structured dependency groups
   */
  const extractDependencies = (deps: any): DependencyGroup[] => {
    if (!deps) return [];

    const groups: DependencyGroup[] = [];

    if (deps.group) {
      const groupArray = Array.isArray(deps.group) ? deps.group : [deps.group];

      for (const group of groupArray) {
        const targetFramework = group.$ ? group.$.targetFramework : undefined;
        const dependencies: PackageDependency[] = [];

        if (group.dependency) {
          const depArray = Array.isArray(group.dependency)
            ? group.dependency
            : [group.dependency];

          for (const dep of depArray) {
            if (dep.$) {
              dependencies.push({
                id: dep.$.id,
                version: dep.$.version,
                exclude: dep.$.exclude,
              });
            }
          }
        }

        groups.push({
          targetFramework,
          dependencies,
        });
      }
    } else if (deps.dependency) {
      // Dependencies without groups
      const depArray = Array.isArray(deps.dependency)
        ? deps.dependency
        : [deps.dependency];
      const dependencies: PackageDependency[] = [];

      for (const dep of depArray) {
        if (dep.$) {
          dependencies.push({
            id: dep.$.id,
            version: dep.$.version,
            exclude: dep.$.exclude,
          });
        }
      }

      if (dependencies.length > 0) {
        groups.push({ dependencies });
      }
    }

    return groups;
  };

  /**
   * Loads package metadata from a nuspec file
   * @param packageId - Package identifier
   * @param version - Package version
   * @param versionPath - File system path to the version directory
   * @returns Package entry with metadata and storage info, or undefined if loading fails
   */
  const loadPackageMetadata = async (
    packageId: string,
    version: string,
    versionPath: string
  ): Promise<PackageEntry | undefined> => {
    try {
      readNuspecIdentity(packageId, version);
      const nuspecPath = path.join(versionPath, `${packageId}.nuspec`);
      const nuspecContent = await fs.readFile(nuspecPath, 'utf-8');

      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(nuspecContent);

      const metadata = result.package?.metadata;
      if (!metadata) {
        logger.warn(`Invalid nuspec format in ${nuspecPath}`);
        return undefined;
      }

      // Extract dependencies
      const dependencies = extractDependencies(metadata.dependencies);

      // Extract tags
      const tags = metadata.tags
        ? typeof metadata.tags === 'string'
          ? parseNuspecTags(metadata.tags)
          : []
        : [];
      const targetFrameworks = extractNuspecTargetFrameworks(metadata);

      const identity = readNuspecIdentity(
        metadata.id ?? packageId,
        metadata.version ?? version
      );

      const packageMetadata: PackageMetadata = {
        ...identity,
        authors: metadata.authors,
        description: metadata.description,
        licenseUrl: metadata.licenseUrl,
        licenseExpression:
          typeof metadata.license === 'object'
            ? metadata.license._
            : metadata.license,
        projectUrl: metadata.projectUrl,
        iconUrl: metadata.iconUrl,
        icon: metadata.icon,
        tags,
        targetFrameworks,
        dependencies,
        published: new Date(), // Use current date as we don't have publish info
        listed: true,
        packageContentUrl: `${currentBaseUrl}/v3/package/${identity.id.toLowerCase()}/${version}/${identity.id.toLowerCase()}.${version}.nupkg`,
      };

      // Read actual file names from directory
      const files = await fs.readdir(versionPath, { withFileTypes: true });
      const actualNupkgFile = files.find(
        (file) => file.isFile() && file.name.endsWith('.nupkg')
      );
      if (!actualNupkgFile) return undefined;

      const packageStorage: PackageStorage = {
        dirName: packageId, // Actual directory name (e.g., "FlashCap")
        versionDirName: version,
        fileName: actualNupkgFile.name, // Use actual file name
        nuspecName: path.basename(nuspecPath), // Use actual nuspec name
      };

      return {
        metadata: packageMetadata,
        storage: packageStorage,
      };
    } catch (error) {
      logger.warn(
        `Failed to load metadata for ${packageId} ${version}: ${error}`
      );
      return undefined;
    }
  };

  /**
   * Scans all versions of a specific package and loads their metadata
   * @param packageId - Package identifier
   * @param packagePath - File system path to the package directory
   */
  const scanPackageVersions = async (
    packageId: string,
    packagePath: string
  ): Promise<void> => {
    try {
      const versionDirs = await fs.readdir(packagePath, {
        withFileTypes: true,
      });
      const versionPromises = versionDirs
        .filter((dir) => dir.isDirectory() && !dir.name.startsWith('.'))
        .map((dir) =>
          loadPackageMetadata(
            packageId,
            dir.name,
            path.join(packagePath, dir.name)
          )
        );

      const results = await Promise.all(versionPromises);
      const entries = results.filter(
        (entry): entry is PackageEntry => entry !== undefined
      );

      if (entries.length > 0) {
        entries.sort((a, b) =>
          compareVersions(b.metadata.version, a.metadata.version)
        ); // Descending order (newest first)
        packagesCache.set(packageId.toLowerCase(), entries);
      }
    } catch (error) {
      logger.warn(`Failed to scan versions for package ${packageId}: ${error}`);
    }
  };

  /**
   * Scans the packages root directory and loads all package metadata
   */
  const scanPackages = async (): Promise<void> => {
    try {
      const packageDirs = await fs.readdir(packagesRoot, {
        withFileTypes: true,
      });
      const packagePromises = packageDirs
        .filter((dir) => dir.isDirectory())
        .map((dir) =>
          scanPackageVersions(dir.name, path.join(packagesRoot, dir.name))
        );

      await Promise.all(packagePromises);
    } catch (error) {
      logger.warn(`Packages directory not found or empty: ${packagesRoot}`);
    }
  };

  return {
    /**
     * Initializes the metadata service by scanning packages directory
     */
    initialize: async (): Promise<void> => {
      const handle = await cacheLock.writeLock();
      try {
        const startTime = Date.now();
        logger.info('Initializing metadata cache...');
        packagesCache.clear();

        try {
          await scanPackages();
          const packageCount = Array.from(packagesCache.values()).reduce(
            (sum, versions) => sum + versions.length,
            0
          );
          const packageIds = packagesCache.size;
          const elapsedTime = Date.now() - startTime;
          logger.info(
            `Metadata cache initialized: ${packageIds} packages, ${packageCount} versions (took ${elapsedTime}ms)`
          );
        } catch (error) {
          logger.error(`Failed to initialize metadata cache: ${error}`);
          throw error;
        }
      } finally {
        handle.release();
      }
    },

    /**
     * Gets all versions of a package
     * @param packageId - Package identifier
     * @returns Array of package metadata for all versions
     */
    getPackageMetadata: (packageId: string): PackageMetadata[] => {
      // Simple read operation - no lock needed for atomic Map.get
      const entries = packagesCache.get(packageId.toLowerCase()) || [];
      return entries.map((entry) => entry.metadata);
    },

    /**
     * Gets metadata for a specific package version
     * @param packageId - Package identifier
     * @param version - Package version
     * @returns Package metadata or undefined if not found
     */
    getPackageVersion: (
      packageId: string,
      version: string
    ): PackageMetadata | undefined => {
      // Simple read operation - no lock needed for atomic Map.get
      const entries = packagesCache.get(packageId.toLowerCase()) || [];
      const metadata = entries.map((entry) => entry.metadata);
      const key = version.toLowerCase();
      return metadata.find((v) => v.version.toLowerCase() === key);
    },

    /**
     * Gets complete package entry (metadata + storage info) for a specific version
     * @param packageId - Package identifier
     * @param version - Package version
     * @returns Package entry or undefined if not found
     */
    getPackageEntry: (
      packageId: string,
      version: string
    ): PackageEntry | undefined => {
      // Simple read operation - no lock needed for atomic Map.get
      const entries = packagesCache.get(packageId.toLowerCase()) || [];
      const key = version.toLowerCase();
      return entries.find(
        (entry) => entry.metadata.version.toLowerCase() === key
      );
    },

    /**
     * Gets all package IDs currently in cache
     * @returns Array of package identifiers
     */
    getAllPackageIds: (): string[] => {
      // Simple read operation - no lock needed for atomic Map.keys
      return Array.from(packagesCache.keys()).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
    },

    /**
     * Gets the latest package entry (metadata + storage info) for a package
     * @param packageId - Package identifier
     * @returns Latest package entry or undefined if package not found
     */
    getLatestPackageEntry: (packageId: string): PackageEntry | undefined => {
      // Simple read operation - no lock needed for atomic Map.get
      const entries = packagesCache.get(packageId.toLowerCase()) || [];
      // Entries are already sorted in descending order (newest first)
      return entries.length > 0 ? entries[0]! : undefined;
    },

    /**
     * Updates the base URL and refreshes all package content URLs
     * @param baseUrl - New base URL for package content
     */
    updateBaseUrl: async (baseUrl: string): Promise<void> => {
      const handle = await cacheLock.writeLock();
      try {
        currentBaseUrl = baseUrl;

        // Update package content URLs
        for (const entries of packagesCache.values()) {
          for (const entry of entries) {
            const packageId = entry.metadata.id.toLowerCase();
            const version = entry.metadata.version;
            entry.metadata.packageContentUrl = `${baseUrl}/package/${packageId}/${version}/${packageId}.${version}.nupkg`;
          }
        }
      } finally {
        handle.release();
      }
    },

    /**
     * Adds a new package to the cache (for uploaded packages)
     * @param metadata - Package metadata to add
     * @param policy - Duplicate package handling policy (default: "ignore")
     * @param saveFiles - Persists the package under the selected on-disk identity, returning false on a duplicate.
     */
    addPackage: async (
      metadata: PackageMetadata,
      policy: DuplicatePackagePolicy = 'ignore',
      saveFiles?: (id: string, version: string) => Promise<boolean>
    ): Promise<{
      action: 'added' | 'overwritten' | 'ignored' | 'error';
      message?: string;
    }> => {
      const handle = await cacheLock.writeLock();
      try {
        const key = metadata.id.toLowerCase();
        const versionKey = metadata.version.toLowerCase();
        const entries = packagesCache.get(key) ?? [];
        const existing = entries.find(
          (entry) => entry.metadata.version.toLowerCase() === versionKey
        );
        const dirName =
          existing?.storage.dirName ??
          entries[0]?.storage.dirName ??
          metadata.id;
        const versionDirName =
          existing?.storage.versionDirName ?? metadata.version;

        // Decide the duplicate policy and finish saving before making the version visible.
        const duplicate = existing && policy !== 'overwrite';
        if (
          duplicate ||
          (saveFiles && !(await saveFiles(dirName, versionDirName)))
        ) {
          const message = `Package ${metadata.id} version ${metadata.version} already exists`;
          if (policy === 'error') {
            logger.warn(message);
            return { action: 'error', message };
          }
          logger.info(
            `Package already exists in cache, ignored: ${metadata.id} ${metadata.version}`
          );
          return { action: 'ignored' };
        }

        // Create a storage entry with the on-disk spelling used by the writer.
        const storage: PackageStorage = {
          dirName,
          versionDirName,
          fileName: `${dirName}.${versionDirName}.nupkg`,
          nuspecName: `${dirName}.nuspec`,
        };
        const next = entries.filter((entry) => entry !== existing);
        next.push({ metadata, storage });
        next.sort((a, b) =>
          compareVersions(b.metadata.version, a.metadata.version)
        );
        packagesCache.set(key, next);
        const action = existing ? 'overwritten' : 'added';
        logger.info(
          `Package ${action} in cache: ${metadata.id} ${metadata.version}`
        );
        return { action };
      } finally {
        handle.release();
      }
    },

    /**
     * Adds a complete package entry to the cache
     * @param entry - Package entry with metadata and storage info
     */
    addPackageEntry: async (entry: PackageEntry): Promise<void> => {
      const handle = await cacheLock.writeLock();
      try {
        const packageId = entry.metadata.id.toLowerCase();
        const existingEntries = packagesCache.get(packageId) || [];

        // Remove existing version if it exists (for overwrite)
        const versionKey = entry.metadata.version.toLowerCase();
        const filteredEntries = existingEntries.filter(
          (e) => e.metadata.version.toLowerCase() !== versionKey
        );

        // Add new version
        filteredEntries.push(entry);
        filteredEntries.sort((a, b) =>
          compareVersions(b.metadata.version, a.metadata.version)
        ); // Descending order (newest first)

        packagesCache.set(packageId, filteredEntries);

        logger.info(
          `Package added to cache: ${entry.metadata.id} ${entry.metadata.version}`
        );
      } finally {
        handle.release();
      }
    },
  };
};
