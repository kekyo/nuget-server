// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import fs from 'fs/promises';
import path from 'path';
import xml2js from 'xml2js';
import { createReaderWriterLock } from 'async-primitives';
import { Logger, DuplicatePackagePolicy } from '../types';
import { compareVersions } from '../utils/semver';

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
    policy?: DuplicatePackagePolicy
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
          ? metadata.tags.split(/[\s,;]+/).filter((t: string) => t)
          : []
        : [];

      const actualPackageId = metadata.id || packageId;

      const packageMetadata: PackageMetadata = {
        id: actualPackageId,
        version: metadata.version || version,
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
        dependencies,
        published: new Date(), // Use current date as we don't have publish info
        listed: true,
        packageContentUrl: `${currentBaseUrl}/v3/package/${actualPackageId.toLowerCase()}/${version}/${actualPackageId.toLowerCase()}.${version}.nupkg`,
      };

      // Read actual file names from directory
      const files = await fs.readdir(versionPath);
      const actualNupkgFile = files.find((file) => file.endsWith('.nupkg'));
      const actualNuspecFile = files.find((file) => file.endsWith('.nuspec'));

      const packageStorage: PackageStorage = {
        dirName: packageId, // Actual directory name (e.g., "FlashCap")
        fileName: actualNupkgFile || `${packageId}.${version}.nupkg`, // Use actual file name
        nuspecName: actualNuspecFile || `${packageId}.nuspec`, // Use actual nuspec name
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
      const versionDirs = await fs.readdir(packagePath);
      const entries: PackageEntry[] = [];

      for (const version of versionDirs) {
        const versionPath = path.join(packagePath, version);
        const stat = await fs.stat(versionPath);

        if (stat.isDirectory()) {
          const entry = await loadPackageMetadata(
            packageId,
            version,
            versionPath
          );
          if (entry) {
            entries.push(entry);
          }
        }
      }

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
      const packageDirs = await fs.readdir(packagesRoot);

      for (const packageId of packageDirs) {
        const packagePath = path.join(packagesRoot, packageId);
        const stat = await fs.stat(packagePath);

        if (stat.isDirectory()) {
          await scanPackageVersions(packageId, packagePath);
        }
      }
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
      return metadata.find((v) => v.version === version);
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
      return entries.find((entry) => entry.metadata.version === version);
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
     */
    addPackage: async (
      metadata: PackageMetadata,
      policy: DuplicatePackagePolicy = 'ignore'
    ): Promise<{
      action: 'added' | 'overwritten' | 'ignored' | 'error';
      message?: string;
    }> => {
      const handle = await cacheLock.writeLock();
      try {
        // Create a simple storage entry for uploaded packages
        const packageStorage: PackageStorage = {
          dirName: metadata.id, // Use the actual package ID from nuspec
          fileName: `${metadata.id}.${metadata.version}.nupkg`,
          nuspecName: `${metadata.id}.nuspec`,
        };

        const packageEntry: PackageEntry = {
          metadata: metadata,
          storage: packageStorage,
        };

        // Inline the addPackageEntry logic to avoid circular reference
        const packageId = packageEntry.metadata.id.toLowerCase();
        const existingEntries = packagesCache.get(packageId) || [];

        // Check if this exact version already exists
        const existingVersion = existingEntries.find(
          (e) => e.metadata.version === packageEntry.metadata.version
        );

        if (existingVersion) {
          // Package version already exists - apply policy
          switch (policy) {
            case 'overwrite':
              // Remove existing version and add new one
              const filteredEntries = existingEntries.filter(
                (e) => e.metadata.version !== packageEntry.metadata.version
              );
              filteredEntries.push(packageEntry);
              filteredEntries.sort((a, b) =>
                compareVersions(b.metadata.version, a.metadata.version)
              ); // Descending order (newest first)
              packagesCache.set(packageId, filteredEntries);

              logger.info(
                `Package overwritten in cache: ${packageEntry.metadata.id} ${packageEntry.metadata.version}`
              );
              return { action: 'overwritten' };

            case 'ignore':
              logger.info(
                `Package already exists in cache, ignored: ${packageEntry.metadata.id} ${packageEntry.metadata.version}`
              );
              return { action: 'ignored' };

            case 'error':
              const errorMessage = `Package ${packageEntry.metadata.id} version ${packageEntry.metadata.version} already exists`;
              logger.warn(errorMessage);
              return { action: 'error', message: errorMessage };

            default:
              // Default to ignore for safety
              logger.info(
                `Package already exists in cache, ignored (default policy): ${packageEntry.metadata.id} ${packageEntry.metadata.version}`
              );
              return { action: 'ignored' };
          }
        } else {
          // New version - add it
          existingEntries.push(packageEntry);
          existingEntries.sort((a, b) =>
            compareVersions(b.metadata.version, a.metadata.version)
          ); // Descending order (newest first)
          packagesCache.set(packageId, existingEntries);

          logger.info(
            `Package added to cache: ${packageEntry.metadata.id} ${packageEntry.metadata.version}`
          );
          return { action: 'added' };
        }
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
        const filteredEntries = existingEntries.filter(
          (e) => e.metadata.version !== entry.metadata.version
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
