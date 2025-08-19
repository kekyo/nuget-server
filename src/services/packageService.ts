// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import fs from 'fs/promises';
import path from 'path';

/**
 * Represents a package version with file paths
 */
export interface PackageVersion {
  version: string;
  packagePath: string;
  nuspecPath: string;
}

/**
 * Information about a package and its versions
 */
export interface PackageInfo {
  id: string;
  versions: PackageVersion[];
}

/**
 * Service interface for accessing package files from disk
 */
export interface PackageService {
  getPackageVersions(packageId: string): Promise<string[]>;
  getPackageFile(packageId: string, version: string): Promise<Buffer | null>;
  getNuspecFile(packageId: string, version: string): Promise<Buffer | null>;
  packageExists(packageId: string, version: string): Promise<boolean>;
}

/**
 * Creates a package service for file system operations
 * @param packagesRoot - Root directory containing package files (default: './packages')
 * @returns Configured package service instance
 */
export const createPackageService = (packagesRoot: string = './packages'): PackageService => {
  return {
    /**
     * Gets all available versions for a package
     * @param packageId - Package identifier
     * @returns Array of version strings
     */
    getPackageVersions: async (packageId: string): Promise<string[]> => {
      const packageDir = path.join(packagesRoot, packageId);
    
    try {
      const versionDirs = await fs.readdir(packageDir);
      const versions = [];
      
      for (const versionDir of versionDirs) {
        const versionPath = path.join(packageDir, versionDir);
        const stat = await fs.stat(versionPath);
        
        if (stat.isDirectory()) {
          const packageFile = `${packageId}.${versionDir}.nupkg`;
          const packagePath = path.join(versionPath, packageFile);
          
          try {
            await fs.access(packagePath);
            versions.push(versionDir);
          } catch {
            // Package file doesn't exist, skip this version
          }
        }
      }
      
      return versions.sort();
    } catch (error) {
      // Package directory doesn't exist
      return [];
    }
    },

    /**
     * Reads a package (.nupkg) file from disk
     * @param packageId - Package identifier
     * @param version - Package version
     * @returns Package file buffer or null if not found
     */
    getPackageFile: async (packageId: string, version: string): Promise<Buffer | null> => {
      const packageFile = `${packageId}.${version}.nupkg`;
      const packagePath = path.join(packagesRoot, packageId, version, packageFile);
      
      try {
        return await fs.readFile(packagePath);
      } catch (error) {
        return null;
      }
    },

    /**
     * Reads a nuspec file from disk
     * @param packageId - Package identifier
     * @param version - Package version
     * @returns Nuspec file buffer or null if not found
     */
    getNuspecFile: async (packageId: string, version: string): Promise<Buffer | null> => {
      const nuspecFile = `${packageId}.nuspec`;
      const nuspecPath = path.join(packagesRoot, packageId, version, nuspecFile);
      
      try {
        return await fs.readFile(nuspecPath);
      } catch (error) {
        return null;
      }
    },

    /**
     * Checks if a package version exists on disk
     * @param packageId - Package identifier
     * @param version - Package version
     * @returns True if package exists, false otherwise
     */
    packageExists: async (packageId: string, version: string): Promise<boolean> => {
      const packageFile = `${packageId}.${version}.nupkg`;
      const packagePath = path.join(packagesRoot, packageId, version, packageFile);
      
      try {
        await fs.access(packagePath);
        return true;
      } catch {
        return false;
      }
    }
  };
};
