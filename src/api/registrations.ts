// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response } from 'express';
import { MetadataService, PackageMetadata } from '../services/metadataService';
import { Logger } from '../types';

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
  listed: boolean;
  minClientVersion?: string;
  packageContent: string;
  projectUrl?: string;
  published: string;
  requireLicenseAcceptance?: boolean;
  summary?: string;
  tags?: string[];
  title?: string;
  version: string;
  dependencyGroups?: DependencyGroup[];
}

/**
 * Group of package dependencies for a specific target framework
 */
export interface DependencyGroup {
  '@type': string;
  targetFramework?: string;
  dependencies?: Dependency[];
}

/**
 * Individual package dependency
 */
export interface Dependency {
  '@type': string;
  id: string;
  range: string;
}

/**
 * Creates the registrations router for package metadata endpoints
 * @param logger - Logger instance for logging registration events
 * @returns Router configuration with metadata service setter
 */
export const createRegistrationsRouter = (logger: Logger) => {
  const router = Router();
  let metadataService: MetadataService;

  const setMetadataService = (service: MetadataService): void => {
    metadataService = service;
  };

/**
 * Creates a registration index for a package with all its versions
 * @param baseUrl - Base URL for API endpoints
 * @param packageId - Package identifier
 * @param versions - Array of package metadata for all versions
 * @returns Complete registration index
 */
const createRegistrationIndex = (baseUrl: string, packageId: string, versions: PackageMetadata[]): RegistrationIndex => {
  const registrationUrl = `${baseUrl}/registrations/${packageId.toLowerCase()}/index.json`;
  
  if (versions.length === 0) {
    return {
      '@id': registrationUrl,
      '@type': ['catalog:CatalogRoot', 'PackageRegistration', 'catalog:Permalink'],
      count: 0,
      items: []
    };
  }

  const items: RegistrationLeaf[] = versions.map(version => {
    const leafUrl = `${baseUrl}/registrations/${packageId.toLowerCase()}/${version.version}.json`;
    
    const dependencyGroups: DependencyGroup[] = version.dependencies ? 
      version.dependencies.map(depGroup => ({
        '@type': 'PackageDependencyGroup',
        targetFramework: depGroup.targetFramework,
        dependencies: depGroup.dependencies.map(dep => ({
          '@type': 'PackageDependency',
          id: dep.id,
          range: dep.version || '[0.0.0, )'
        }))
      })) : [];

    const catalogEntry: CatalogEntry = {
      '@id': leafUrl,
      '@type': 'PackageDetails',
      authors: version.authors || '',
      description: version.description,
      iconUrl: version.iconUrl,
      icon: version.icon,
      id: version.id,
      language: 'en-US',
      licenseExpression: version.licenseExpression,
      licenseUrl: version.licenseUrl,
      listed: version.listed,
      packageContent: version.packageContentUrl,
      projectUrl: version.projectUrl,
      published: version.published.toISOString(),
      requireLicenseAcceptance: false,
      tags: version.tags,
      title: version.id,
      version: version.version,
      dependencyGroups: dependencyGroups.length > 0 ? dependencyGroups : undefined
    };

    return {
      '@id': leafUrl,
      '@type': 'Package',
      catalogEntry,
      packageContent: version.packageContentUrl,
      registration: registrationUrl
    };
  });

  const page: RegistrationPage = {
    '@id': `${registrationUrl}#page/${versions[0].version}/${versions[versions.length - 1].version}`,
    '@type': 'catalog:CatalogPage',
    count: items.length,
    items,
    lower: versions[0].version,
    upper: versions[versions.length - 1].version
  };

  return {
    '@id': registrationUrl,
    '@type': ['catalog:CatalogRoot', 'PackageRegistration', 'catalog:Permalink'],
    count: 1,
    items: [page]
  };
}

router.get('/:id/index.json', async (req: Request, res: Response) => {
  if (!metadataService) {
    return res.status(500).json({ error: 'Metadata service not initialized' });
  }

  const packageId = req.params.id;
  const baseUrl = req.baseUrl;
  
  try {
    const versions = metadataService.getPackageMetadata(packageId);
    const registrationIndex = createRegistrationIndex(baseUrl, packageId, versions);
    
    res.json(registrationIndex);
  } catch (error) {
    logger.error(`Error getting registration index for ${packageId}: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/:version.json', async (req: Request, res: Response) => {
  if (!metadataService) {
    return res.status(500).json({ error: 'Metadata service not initialized' });
  }

  const packageId = req.params.id;
  const version = req.params.version;
  const baseUrl = req.baseUrl;
  
  try {
    const packageMetadata = metadataService.getPackageVersion(packageId, version);
    
    if (!packageMetadata) {
      return res.status(404).json({ error: 'Package version not found' });
    }

    const registrationUrl = `${baseUrl}/registrations/${packageId.toLowerCase()}/index.json`;
    const leafUrl = `${baseUrl}/registrations/${packageId.toLowerCase()}/${version}.json`;
    
    const dependencyGroups: DependencyGroup[] = packageMetadata.dependencies ? 
      packageMetadata.dependencies.map(depGroup => ({
        '@type': 'PackageDependencyGroup',
        targetFramework: depGroup.targetFramework,
        dependencies: depGroup.dependencies.map(dep => ({
          '@type': 'PackageDependency',
          id: dep.id,
          range: dep.version || '[0.0.0, )'
        }))
      })) : [];

    const catalogEntry: CatalogEntry = {
      '@id': leafUrl,
      '@type': 'PackageDetails',
      authors: packageMetadata.authors || '',
      description: packageMetadata.description,
      iconUrl: packageMetadata.iconUrl,
      icon: packageMetadata.icon,
      id: packageMetadata.id,
      language: 'en-US',
      licenseExpression: packageMetadata.licenseExpression,
      licenseUrl: packageMetadata.licenseUrl,
      listed: packageMetadata.listed,
      packageContent: packageMetadata.packageContentUrl,
      projectUrl: packageMetadata.projectUrl,
      published: packageMetadata.published.toISOString(),
      requireLicenseAcceptance: false,
      tags: packageMetadata.tags,
      title: packageMetadata.id,
      version: packageMetadata.version,
      dependencyGroups: dependencyGroups.length > 0 ? dependencyGroups : undefined
    };

    const leaf: RegistrationLeaf = {
      '@id': leafUrl,
      '@type': 'Package',
      catalogEntry,
      packageContent: packageMetadata.packageContentUrl,
      registration: registrationUrl
    };
    
    res.json(leaf);
  } catch (error) {
    logger.error(`Error getting registration leaf for ${packageId} ${version}: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  return { router, setMetadataService };
};