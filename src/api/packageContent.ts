// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response } from 'express';
import { createPackageService } from '../services/packageService';
import { MetadataService } from '../services/metadataService';
import { Logger } from '../types';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';

/**
 * Response format for package versions endpoint
 */
export interface PackageVersionsResponse {
  versions: string[];
}

/**
 * Creates the package content router for serving package files
 * @param logger - Logger instance for logging package content events
 * @param packagesRoot - Root directory for package storage
 * @returns Router configuration with metadata service setter
 */
export const createPackageContentRouter = (logger: Logger, packagesRoot: string) => {
  const router = Router();
  const packageService = createPackageService(packagesRoot);
  let metadataService: MetadataService | null = null;

  const setPackageContentMetadataService = (service: MetadataService) => {
    metadataService = service;
  };

// Icon endpoint - serves package icons (must be before /:id/:version/:filename)
router.get('/:id/:version/icon', async (req: Request, res: Response) => {
  const packageId = req.params.id.toLowerCase();
  const version = req.params.version.toLowerCase();

  if (!metadataService) {
    return res.status(500).json({ error: 'Metadata service not available' });
  }

  try {
    // Find the package entry
    const entry = metadataService.getPackageEntry(packageId, version);
    logger.debug(`Looking for package entry ${packageId}/${version}, found: ${entry ? 'YES' : 'NO'}`);
    if (entry) {
      logger.debug(`Package entry storage.dirName: ${entry.storage.dirName}`);
    }
    if (!entry) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Look for icon files in the package directory
    const packageDir = join(packagesRoot, entry.storage.dirName, version);
    
    try {
      const files = await fs.readdir(packageDir);
      const iconFile = files.find(file => file.startsWith('icon.'));
      
      if (!iconFile) {
        return res.status(404).json({ error: 'Package icon not found' });
      }

      const iconPath = resolve(join(packageDir, iconFile));
      const iconExt = iconFile.split('.').pop()?.toLowerCase();
      
      // Set appropriate content type
      const mimeTypes: Record<string, string> = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'gif': 'image/gif'
      };

      const contentType = mimeTypes[iconExt || ''] || 'application/octet-stream';
      
      // Set caching headers (cache for 1 year)
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
        'ETag': `"${packageId}-${version}-${iconFile}"`
      });

      // Send the icon file
      res.sendFile(iconPath);
      logger.debug(`Icon served successfully: ${packageId} ${version} (${iconFile})`);
      
    } catch (fsError) {
      logger.warn(`Icon directory read error for ${packageId} ${version}: ${fsError}`);
      return res.status(404).json({ error: 'Package icon not found' });
    }
    
  } catch (error) {
    logger.error(`Error serving icon for ${packageId} ${version}: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/index.json', async (req: Request, res: Response) => {
  const packageId = req.params.id.toLowerCase();

  try {
    // Use MetadataService if available, fallback to PackageService
    let versions: string[] = [];
    
    if (metadataService) {
      const packageMetadata = metadataService.getPackageMetadata(packageId);
      versions = packageMetadata.map(pkg => pkg.version);
    } else {
      versions = await packageService.getPackageVersions(packageId);
    }

    const response: PackageVersionsResponse = {
      versions: versions
    };

    res.json(response);
  } catch (error) {
    logger.error(`Error getting package versions: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/:version/:filename', async (req: Request, res: Response) => {
  const packageId = req.params.id.toLowerCase();
  const version = req.params.version.toLowerCase();
  const filename = req.params.filename.toLowerCase();

  const expectedNupkgName = `${packageId}.${version}.nupkg`;
  const expectedNuspecName = `${packageId}.nuspec`;

  // Find the actual package entry from MetadataService
  let actualDirName = packageId;
  if (metadataService) {
    const entry = metadataService.getPackageEntry(packageId, version);
    if (entry) {
      actualDirName = entry.storage.dirName; // Use the actual directory name
    }
  }

  try {
    if (filename === expectedNupkgName) {
      logger.info(`Serving package: ${packageId} ${version} (actual dir: ${actualDirName})`);
      const packageData = await packageService.getPackageFile(actualDirName, version);

      if (!packageData) {
        logger.warn(`Package not found: ${packageId} ${version} (actual dir: ${actualDirName})`);
        return res.status(404).json({ error: 'Package not found' });
      }

      // Get the actual filename from PackageEntry
      const entry = metadataService?.getPackageEntry(packageId, version);
      const downloadFileName = entry?.storage.fileName || filename;

      logger.info(`Package served successfully: ${packageId} ${version} (${packageData.length} bytes) as "${downloadFileName}"`);
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${downloadFileName}"`
      });

      res.send(packageData);
    } else if (filename === expectedNuspecName) {
      logger.info(`Serving nuspec: ${packageId} ${version} (actual dir: ${actualDirName})`);
      const nuspecData = await packageService.getNuspecFile(actualDirName, version);

      if (!nuspecData) {
        logger.warn(`Nuspec not found: ${packageId} ${version} (actual dir: ${actualDirName})`);
        return res.status(404).json({ error: 'Nuspec file not found' });
      }

      logger.info(`Nuspec served successfully: ${packageId} ${version} (${nuspecData.length} bytes)`);
      res.set({
        'Content-Type': 'application/xml'
      });

      res.send(nuspecData);
    } else {
      logger.warn(`File not found: ${filename} for ${packageId} ${version}`);
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    logger.error(`Error serving package file for ${packageId} ${version}: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  return { router, setPackageContentMetadataService };
};
