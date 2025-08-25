// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join } from 'path';
import { mkdir, unlink, writeFile, copyFile } from 'fs/promises';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import xml2js from 'xml2js';
import AdmZip from 'adm-zip';
import { PackageMetadata } from '../../../services/metadataService';
import { Logger } from '../../../types';
import { AuthService } from '../../../services/authService';
import { createConditionalHybridAuthMiddleware, FastifyAuthConfig, AuthenticatedFastifyRequest } from '../../../middleware/fastifyAuth';
import { createUrlResolver } from '../../../utils/urlResolver';

/**
 * Service interface for handling package uploads
 */
export interface PackageUploadService {
  addPackage(metadata: PackageMetadata): void;
}

/**
 * Configuration for publish routes
 */
export interface PublishRoutesConfig {
  packagesRoot: string;
  authService: AuthService;
  authConfig: FastifyAuthConfig;
  logger: Logger;
  urlResolver: ReturnType<typeof createUrlResolver>;
}

/**
 * Publish response interface
 */
export interface PublishResponse {
  message: string;
  id: string;
  version: string;
}

/**
 * Registers package publish API routes with Fastify instance
 */
export const registerPublishRoutes = async (fastify: FastifyInstance, config: PublishRoutesConfig) => {
  const { packagesRoot, authService, authConfig, logger, urlResolver } = config;
  
  let packageUploadService: PackageUploadService | null = null;

  const setPackageUploadService = (service: PackageUploadService) => {
    packageUploadService = service;
  };

  // Helper to create conditional auth middleware based on authMode
  const createAuthHandler = () => {
    const authMode = authService.getAuthMode();
    if (authMode === 'none') {
      // No authentication required for publish
      return null;
    }
    // For 'publish' and 'full' modes, require hybrid authentication with publish/admin role
    return createConditionalHybridAuthMiddleware(authConfig);
  };

  const authHandler = createAuthHandler();

  // Apply authentication middleware conditionally
  const authPreHandler = authHandler ? [authHandler] : [];

  // POST /api/publish - Package upload endpoint
  fastify.post('/publish', {
    preHandler: authPreHandler.length > 0 ? [
      ...authPreHandler,
      async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
        // Check role permissions for non-none auth modes
        if (authService.getAuthMode() !== 'none') {
          if (!request.user || !['publish', 'admin'].includes(request.user.role)) {
            return reply.status(403).send({ error: 'Publish permission required' });
          }
        }
      }
    ] : []
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let tempFilePath: string | null = null;
    
    try {
      if (!packageUploadService) {
        return reply.status(500).send({ error: 'Package upload service not initialized' });
      }

      // Get the parsed buffer body
      const packageData = request.body as Buffer;
      
      if (!packageData || packageData.length === 0) {
        return reply.status(400).send({ error: 'No package data received' });
      }

      // Create temporary file for the package data
      tempFilePath = join(tmpdir(), `nuget-upload_${randomUUID()}.tmp`);
      await writeFile(tempFilePath, packageData);

      // Validate package format by opening ZIP file directly
      let zip: AdmZip;
      try {
        zip = new AdmZip(tempFilePath);
      } catch (error) {
        return reply.status(400).send({ error: 'Invalid package format - not a valid ZIP file' });
      }

      // Extract nuspec file
      const nuspecEntry = zip.getEntries().find(entry => entry.entryName.endsWith('.nuspec'));
      if (!nuspecEntry) {
        return reply.status(400).send({ error: 'Package does not contain a .nuspec file' });
      }

      // Parse nuspec
      const nuspecContent = nuspecEntry.getData().toString('utf8');
      let packageMetadata: PackageMetadata;
      
      try {
        packageMetadata = await parseNuspec(nuspecContent);
      } catch (error) {
        return reply.status(400).send({ error: 'Failed to parse .nuspec file: ' + (error as Error).message });
      }

      // Create package directory structure
      const packageId = packageMetadata.id;
      const version = packageMetadata.version;
      const packageDir = join(packagesRoot, packageId, version);

      try {
        await mkdir(packageDir, { recursive: true });

        // Save nupkg file by copying from temp file
        const nupkgPath = join(packageDir, `${packageId}.${version}.nupkg`);
        await copyFile(tempFilePath, nupkgPath);

        // Save nuspec file
        const nuspecPath = join(packageDir, `${packageId}.nuspec`);
        await writeFile(nuspecPath, nuspecContent);

        // Extract icon if present
        if (packageMetadata.icon) {
          try {
            const iconEntry = zip.getEntries().find(entry => entry.entryName === packageMetadata.icon);
            if (iconEntry) {
              const iconData = iconEntry.getData();
              const iconExtension = packageMetadata.icon.split('.').pop()?.toLowerCase() || 'png';
              const iconFileName = `icon.${iconExtension}`;
              const iconPath = join(packageDir, iconFileName);
              await writeFile(iconPath, iconData);
              logger.info(`Extracted icon: ${iconFileName} for package ${packageId} ${version}`);
            } else {
              logger.warn(`Icon file ${packageMetadata.icon} specified in nuspec but not found in package ${packageId} ${version}`);
            }
          } catch (error) {
            logger.error(`Failed to extract icon for package ${packageId} ${version}: ${error}`);
          }
        }

        // Update package content URL using urlResolver
        const baseUrl = urlResolver.resolveUrl(request).baseUrl;
        
        packageMetadata.packageContentUrl = `${baseUrl}/api/package/${packageId.toLowerCase()}/${version}/${packageId.toLowerCase()}.${version}.nupkg`;

        // Add to memory cache
        packageUploadService.addPackage(packageMetadata);

        const response: PublishResponse = {
          message: 'Package uploaded successfully',
          id: packageId,
          version: version
        };

        logger.info(`Package uploaded successfully: ${packageId} ${version}`);
        return reply.status(201).send(response);

      } catch (error) {
        return reply.status(500).send({ error: 'Failed to save package: ' + (error as Error).message });
      }

    } catch (error) {
      logger.error(`Package upload error: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    } finally {
      // Clean up temporary file
      if (tempFilePath) {
        try {
          await unlink(tempFilePath);
        } catch (error) {
          logger.error(`Failed to clean up temporary file: ${tempFilePath} - ${error}`);
        }
      }
    }
  });

  logger.info('Package publish API routes registered successfully');

  return { setPackageUploadService };
};

/**
 * Parses a nuspec XML file and extracts package metadata
 * @param nuspecContent - Raw XML content of the nuspec file
 * @returns Parsed package metadata
 * @throws Error if nuspec format is invalid
 */
const parseNuspec = async (nuspecContent: string): Promise<PackageMetadata> => {
  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(nuspecContent);
  
  const metadata = result.package?.metadata;
  if (!metadata) {
    throw new Error('Invalid nuspec format - missing metadata section');
  }

  if (!metadata.id || !metadata.version) {
    throw new Error('Invalid nuspec format - missing id or version');
  }

  // Extract dependencies
  const dependencies = extractDependencies(metadata.dependencies);
  
  // Extract tags
  const tags = metadata.tags ? 
    (typeof metadata.tags === 'string' ? metadata.tags.split(/[\s,]+/).filter((t: string) => t) : []) : 
    [];

  return {
    id: metadata.id,
    version: metadata.version,
    authors: metadata.authors,
    description: metadata.description,
    licenseUrl: metadata.licenseUrl,
    licenseExpression: typeof metadata.license === 'object' ? metadata.license._ : metadata.license,
    projectUrl: metadata.projectUrl,
    iconUrl: metadata.iconUrl,
    icon: metadata.icon,
    tags,
    dependencies,
    published: new Date(),
    listed: true,
    packageContentUrl: '' // Will be set later
  };
};

/**
 * Extracts dependency information from nuspec XML structure
 * @param deps - Raw dependency data from XML parser
 * @returns Array of dependency groups
 */
const extractDependencies = (deps: any): any[] => {
  if (!deps) return [];
  
  const groups: any[] = [];
  
  if (deps.group) {
    const groupArray = Array.isArray(deps.group) ? deps.group : [deps.group];
    
    for (const group of groupArray) {
      const targetFramework = group.$ ? group.$.targetFramework : undefined;
      const dependencies: any[] = [];
      
      if (group.dependency) {
        const depArray = Array.isArray(group.dependency) ? group.dependency : [group.dependency];
        
        for (const dep of depArray) {
          if (dep.$) {
            dependencies.push({
              id: dep.$.id,
              version: dep.$.version,
              exclude: dep.$.exclude
            });
          }
        }
      }
      
      groups.push({
        targetFramework,
        dependencies
      });
    }
  } else if (deps.dependency) {
    // Dependencies without groups
    const depArray = Array.isArray(deps.dependency) ? deps.dependency : [deps.dependency];
    const dependencies: any[] = [];
    
    for (const dep of depArray) {
      if (dep.$) {
        dependencies.push({
          id: dep.$.id,
          version: dep.$.version,
          exclude: dep.$.exclude
        });
      }
    }
    
    if (dependencies.length > 0) {
      groups.push({ dependencies });
    }
  }
  
  return groups;
};