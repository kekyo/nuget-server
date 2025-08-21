// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response } from 'express';
import { MetadataService, PackageMetadata } from '../services/metadataService';
import { Logger } from '../types';

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
 * Creates the search router for SearchQueryService endpoints
 * @param logger - Logger instance for logging search events
 * @returns Router configuration with metadata service setter
 */
export const createSearchRouter = (logger: Logger) => {
  const router = Router();
  let metadataService: MetadataService;

  const setMetadataService = (service: MetadataService): void => {
    metadataService = service;
  };

  /**
   * Converts package metadata to search result format
   * @param baseUrl - Base URL for API endpoints
   * @param packageId - Package identifier
   * @param versions - Array of package metadata for all versions
   * @returns Search result object
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
      '@id': `${baseUrl}/registrations/${packageId.toLowerCase()}/${version.version}.json`
    }));

    return {
      '@type': 'Package',
      registration: `${baseUrl}/registrations/${packageId.toLowerCase()}/index.json`,
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
   * SearchQueryService endpoint - returns all packages
   * Ignores all query parameters and always returns all packages
   */
  router.get('/', async (req: Request, res: Response) => {
    if (!metadataService) {
      return res.status(500).json({ error: 'Metadata service not initialized' });
    }

    // Extract base URL from headers and request info
    const protocol = req.get('x-forwarded-proto') || (req.connection as any)?.encrypted ? 'https' : 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    const baseUrl = `${protocol}://${host}/api`;
    
    try {
      // Get all package IDs
      const packageIds = metadataService.getAllPackageIds();
      
      // Convert to search results
      const searchResults: SearchResult[] = [];
      
      for (const packageId of packageIds) {
        const versions = metadataService.getPackageMetadata(packageId);
        if (versions.length > 0) {
          // Use actual package ID from metadata (not lowercase cache key)
          const actualPackageId = versions[0].id;
          const searchResult = createSearchResult(baseUrl, actualPackageId, versions);
          searchResults.push(searchResult);
        }
      }

      const response: SearchResponse = {
        '@context': {
          '@vocab': 'http://schema.nuget.org/schema#',
          '@base': `${baseUrl}/`
        },
        totalHits: searchResults.length,
        lastReopen: new Date().toISOString(),
        index: 'v3-lucene0',
        data: searchResults
      };

      res.json(response);
    } catch (error) {
      logger.error(`Error in search endpoint: ${error}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return { router, setMetadataService };
};