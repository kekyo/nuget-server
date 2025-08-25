// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Logger } from '../../types';
import { MetadataService, PackageMetadata } from '../../services/metadataService';
import { AuthService } from '../../services/authService';
import { createConditionalHybridAuthMiddleware, FastifyAuthConfig, AuthenticatedFastifyRequest } from '../../middleware/fastifyAuth';
import { createPackageService } from '../../services/packageService';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { createUrlResolver } from '../../utils/urlResolver';

/**
 * Service Index Resource interface for NuGet V3 API
 */
export interface ServiceIndexResource {
  '@id': string;
  '@type': string;
  comment: string;
}

/**
 * Service Index response structure
 */
export interface ServiceIndex {
  '@context': string;
  version: string;
  resources: ServiceIndexResource[];
}

/**
 * Search result version entry
 */
export interface SearchResultVersion {
  version: string;
  downloads: number;
  '@id': string;
}

/**
 * Individual package search result
 */
export interface SearchResult {
  '@type': string;
  registration: string;
  id: string;
  version: string;
  description: string;
  summary: string;
  title: string;
  iconUrl?: string;
  licenseUrl?: string;
  license?: string;
  projectUrl?: string;
  tags: string[];
  authors: string[];
  totalDownloads: number;
  verified: boolean;
  packageTypes: Array<{
    name: string;
  }>;
  versions: SearchResultVersion[];
}

/**
 * Search query response
 */
export interface SearchResponse {
  '@context': {
    '@vocab': string;
    '@base': string;
  };
  totalHits: number;
  lastReopen: string;
  index: string;
  data: SearchResult[];
}

/**
 * Registration index response for a package
 */
export interface RegistrationIndex {
  '@id': string;
  '@type': string[];
  'commitId'?: string;
  'commitTimeStamp'?: string;
  count: number;
  items: RegistrationPage[];
}

/**
 * Registration page containing package versions
 */
export interface RegistrationPage {
  '@id': string;
  '@type': string;
  'commitId'?: string;
  'commitTimeStamp'?: string;
  count: number;
  items: RegistrationLeaf[];
  lower?: string;
  upper?: string;
}

/**
 * Individual package version entry in registration
 */
export interface RegistrationLeaf {
  '@id': string;
  '@type': string;
  'commitId'?: string;
  'commitTimeStamp'?: string;
  catalogEntry: CatalogEntry;
  packageContent: string;
  registration: string;
}

/**
 * Catalog entry with package metadata
 */
export interface CatalogEntry {
  '@id': string;
  '@type': string;
  authors: string;
  description?: string;
  iconUrl?: string;
  icon?: string;
  id: string;
  language?: string;
  licenseExpression?: string;
  licenseUrl?: string;
  listed?: boolean;
  minClientVersion?: string;
  packageContent: string;
  projectUrl?: string;
  published: string;
  requireLicenseAcceptance?: boolean;
  summary?: string;
  tags?: string[];
  title?: string;
  version: string;
}

/**
 * Configuration for V3 API routes
 */
export interface V3RoutesConfig {
  metadataService: MetadataService;
  authService: AuthService;
  authConfig: FastifyAuthConfig;
  packagesRoot: string;
  logger: Logger;
  urlResolver: ReturnType<typeof createUrlResolver>;
}

/**
 * Creates a service index configuration for the given base URL
 */
const createServiceIndex = (baseUrl: string): ServiceIndex => {
  return {
    '@context': 'https://api.nuget.org/v3/index.json',
    version: '3.0.0',
    resources: [
      {
        '@id': `${baseUrl}/v3/package/`,
        '@type': 'PackageBaseAddress/3.0.0',
        comment: `Base URL of where NuGet packages are stored, in the format ${baseUrl}/v3/package/{id}/{version}/{id}.{version}.nupkg`
      },
      {
        '@id': `${baseUrl}/v3/registrations/`,
        '@type': 'RegistrationsBaseUrl',
        comment: 'Base URL of NuGet package registration info'
      },
      {
        '@id': `${baseUrl}/v3/search`,
        '@type': 'SearchQueryService',
        comment: 'Query endpoint of NuGet Search service'
      }
    ]
  };
};

/**
 * Converts package metadata to search result format
 */
const createSearchResult = (baseUrl: string, packageId: string, versions: PackageMetadata[]): SearchResult => {
  if (versions.length === 0) {
    throw new Error('No versions provided for package');
  }

  // Use the latest version for main package info
  const latestVersion = versions[versions.length - 1];
  
  // Create version entries
  const versionEntries: SearchResultVersion[] = versions.map(version => ({
    version: version.version,
    downloads: 0, // Not tracked in this implementation
    '@id': `${baseUrl}/v3/registrations/${packageId.toLowerCase()}/${version.version}.json`
  }));

  return {
    '@type': 'Package',
    registration: `${baseUrl}/v3/registrations/${packageId.toLowerCase()}/index.json`,
    id: packageId,
    version: latestVersion.version,
    description: latestVersion.description || '',
    summary: latestVersion.description || '',
    title: latestVersion.id,
    iconUrl: latestVersion.iconUrl,
    licenseUrl: latestVersion.licenseUrl,
    license: latestVersion.licenseExpression,
    projectUrl: latestVersion.projectUrl,
    tags: latestVersion.tags || [],
    authors: latestVersion.authors ? latestVersion.authors.split(',').map(a => a.trim()) : [],
    totalDownloads: 0, // Not tracked in this implementation
    verified: false, // Not implemented
    packageTypes: [
      {
        name: 'Dependency'
      }
    ],
    versions: versionEntries
  };
};

/**
 * Creates catalog entry from package metadata
 */
const createCatalogEntry = (baseUrl: string, metadata: PackageMetadata): CatalogEntry => {
  return {
    '@id': `${baseUrl}/v3/catalog/entries/${metadata.id.toLowerCase()}/${metadata.version}.json`,
    '@type': 'PackageDetails',
    authors: metadata.authors || metadata.id,
    description: metadata.description,
    iconUrl: metadata.iconUrl,
    icon: metadata.iconUrl,
    id: metadata.id,
    language: undefined, // Not available in PackageMetadata
    licenseExpression: metadata.licenseExpression,
    licenseUrl: metadata.licenseUrl,
    listed: metadata.listed,
    minClientVersion: undefined, // Not available in PackageMetadata
    packageContent: `${baseUrl}/v3/package/${metadata.id.toLowerCase()}/${metadata.version}/${metadata.id.toLowerCase()}.${metadata.version}.nupkg`,
    projectUrl: metadata.projectUrl,
    published: metadata.published ? metadata.published.toISOString() : new Date().toISOString(),
    requireLicenseAcceptance: false, // Not available in PackageMetadata
    summary: metadata.description, // Use description as summary
    tags: metadata.tags || [],
    title: metadata.id, // Use ID as title
    version: metadata.version
  };
};

/**
 * Registers NuGet V3 API routes with Fastify instance
 */
export const registerV3Routes = async (fastify: FastifyInstance, config: V3RoutesConfig) => {
  const { metadataService, authService, authConfig, packagesRoot, logger, urlResolver } = config;
  const packageService = createPackageService(packagesRoot);

  // Helper to get base URL from request using urlResolver
  const getBaseUrl = (request: FastifyRequest): string => {
    return urlResolver.resolveUrl(request).baseUrl;
  };

  // Helper to create conditional auth middleware based on authMode
  const createAuthHandler = () => {
    const authMode = authService.getAuthMode();
    if (authMode === 'full') {
      // For full auth mode, require hybrid authentication
      return createConditionalHybridAuthMiddleware(authConfig);
    }
    // For 'none' and 'publish' modes, no authentication required for V3 read APIs
    return null;
  };

  const authHandler = createAuthHandler();

  // Apply authentication middleware conditionally
  const authPreHandler = authHandler ? [authHandler] : [];

  // V3 Service Index - GET /v3/index.json
  fastify.get('/v3/index.json', {
    preHandler: authPreHandler
  }, async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    try {
      const baseUrl = getBaseUrl(request);
      const serviceIndex = createServiceIndex(baseUrl);
      return reply.send(serviceIndex);
    } catch (error) {
      logger.error(`Error in V3 service index: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // V3 Package Search - GET /v3/search
  fastify.get('/v3/search', {
    preHandler: authPreHandler
  }, async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    try {
      const baseUrl = getBaseUrl(request);
      
      // Log query parameters for debugging
      const query = request.query as Record<string, any>;
      logger.debug(`V3 search request - Query params: ${JSON.stringify(query)}, Host: ${request.headers.host}`);
      
      // Parse query parameters
      const q = (query.q as string || '').toLowerCase();
      const skip = parseInt(query.skip as string || '0', 10);
      const take = parseInt(query.take as string || '20', 10);
      const prerelease = query.prerelease !== 'false'; // Default to true
      const semVerLevel = query.semVerLevel || '2.0.0';
      
      // Get all package IDs
      const packageIds = metadataService.getAllPackageIds();
      
      // Filter and convert to search results
      const allSearchResults: SearchResult[] = [];
      
      for (const packageId of packageIds) {
        const versions = metadataService.getPackageMetadata(packageId);
        if (versions.length > 0) {
          // Use actual package ID from metadata (not lowercase cache key)
          const actualPackageId = versions[0].id;
          
          // Filter by search query if provided
          if (q && !actualPackageId.toLowerCase().includes(q)) {
            // Also check description
            const hasMatchingDescription = versions.some(v => 
              v.description && v.description.toLowerCase().includes(q)
            );
            if (!hasMatchingDescription) {
              continue;
            }
          }
          
          const searchResult = createSearchResult(baseUrl, actualPackageId, versions);
          allSearchResults.push(searchResult);
        }
      }
      
      // Apply pagination
      const searchResults = allSearchResults.slice(skip, skip + take);

      const response: SearchResponse = {
        '@context': {
          '@vocab': 'http://schema.nuget.org/schema#',
          '@base': `${baseUrl}/v3/`
        },
        totalHits: allSearchResults.length, // Total count before pagination
        lastReopen: new Date().toISOString(),
        index: 'v3-lucene0',
        data: searchResults // Paginated results
      };

      return reply.send(response);
    } catch (error) {
      logger.error(`Error in V3 search endpoint: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // V3 PackageBaseAddress Index - GET /v3/package/{id}/index.json
  // Returns list of versions for a package
  fastify.get('/v3/package/:id/index.json', {
    preHandler: authPreHandler
  }, async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    const { id: packageId } = request.params as { id: string };
    const lowerId = packageId.toLowerCase();

    try {
      // Get all versions for the package
      const versions = metadataService.getPackageMetadata(lowerId);
      
      if (versions.length === 0) {
        logger.debug(`V3: Package versions list not found: ${packageId}`);
        return reply.status(404).send({ error: 'Package not found' });
      }

      // Return PackageBaseAddress index format with list of versions
      const response = {
        versions: versions.map(v => v.version)
      };
      
      logger.debug(`V3: Package versions list served: ${packageId} (${versions.length} versions)`);
      return reply.type('application/json').send(response);
    } catch (error) {
      logger.error(`V3: Error in package versions endpoint for ${packageId}: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // V3 Package Download - GET /v3/package/{id}/{version}/{filename}
  fastify.get('/v3/package/:id/:version/:filename', {
    preHandler: authPreHandler
  }, async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    const { id: packageId, version, filename } = request.params as { id: string; version: string; filename: string };
    const lowerId = packageId.toLowerCase();
    const lowerVersion = version.toLowerCase();
    const lowerFilename = filename.toLowerCase();

    const expectedNupkgName = `${lowerId}.${lowerVersion}.nupkg`;

    try {
      if (lowerFilename === expectedNupkgName) {
        logger.info(`V3: Serving package: ${packageId} ${version}`);
        
        // Find the actual package entry from MetadataService
        let actualDirName = lowerId;
        const entry = metadataService.getPackageEntry(lowerId, lowerVersion);
        if (entry) {
          actualDirName = entry.storage.dirName; // Use the actual directory name
        }

        const packagePath = await packageService.getPackageFilePath(actualDirName, lowerVersion);

        if (!packagePath) {
          logger.info(`V3: Package not found: ${packageId} ${version}`);
          return reply.status(404).send({ error: 'Package not found' });
        }

        // Get the actual filename from PackageEntry
        const downloadFileName = entry?.storage.fileName || filename;

        logger.info(`V3: Package served successfully: ${packageId} ${version} as "${downloadFileName}"`);
        
        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', `attachment; filename="${downloadFileName}"`);

        return reply.sendFile(packagePath);
      } else {
        logger.warn(`V3: File not found: ${filename} for ${packageId} ${version}`);
        return reply.status(404).send({ error: 'File not found' });
      }
    } catch (error) {
      logger.error(`V3: Error serving package file for ${packageId} ${version}: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // V3 Registrations - GET /v3/registrations/{id}/index.json
  fastify.get('/v3/registrations/:id/index.json', {
    preHandler: authPreHandler
  }, async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    const { id: packageId } = request.params as { id: string };
    const lowerId = packageId.toLowerCase();

    try {
      const baseUrl = getBaseUrl(request);
      const versions = metadataService.getPackageMetadata(lowerId);

      if (versions.length === 0) {
        logger.info(`V3: Package not found in registrations: ${packageId}`);
        return reply.status(404).send({ error: 'Package not found' });
      }

      // Create registration leaves for each version
      const registrationLeaves: RegistrationLeaf[] = versions.map(metadata => ({
        '@id': `${baseUrl}/v3/registrations/${lowerId}/${metadata.version}.json`,
        '@type': 'Package',
        catalogEntry: createCatalogEntry(baseUrl, metadata),
        packageContent: `${baseUrl}/v3/package/${lowerId}/${metadata.version}/${lowerId}.${metadata.version}.nupkg`,
        registration: `${baseUrl}/v3/registrations/${lowerId}/index.json`
      }));

      // Create a single page containing all versions
      const page: RegistrationPage = {
        '@id': `${baseUrl}/v3/registrations/${lowerId}/index.json#page/${versions[0].version}/${versions[versions.length - 1].version}`,
        '@type': 'catalog:CatalogPage',
        count: versions.length,
        items: registrationLeaves,
        lower: versions[0].version,
        upper: versions[versions.length - 1].version
      };

      const registrationIndex: RegistrationIndex = {
        '@id': `${baseUrl}/v3/registrations/${lowerId}/index.json`,
        '@type': ['catalog:CatalogRoot', 'PackageRegistration', 'catalog:Permalink'],
        'commitTimeStamp': new Date().toISOString(),
        count: 1,
        items: [page]
      };

      logger.info(`V3: Registration served successfully: ${packageId} (${versions.length} versions)`);
      return reply.send(registrationIndex);
    } catch (error) {
      logger.error(`V3: Error in registrations endpoint for ${packageId}: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  logger.info('NuGet V3 API routes registered successfully');
};