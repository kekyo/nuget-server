// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Represents a service index resource in the NuGet protocol
 */
export interface ServiceIndexResource {
  '@id': string;
  '@type': string;
  comment: string;
}

/**
 * Main service index response structure
 */
export interface ServiceIndex {
  version: string;
  resources: ServiceIndexResource[];
}

/**
 * Creates a service index configuration for the given base URL
 * @param baseUrl - The base URL for API endpoints
 * @returns Service index configuration
 */
const createServiceIndex = (baseUrl: string): ServiceIndex => {
  return {
    version: '3.0.0',
    resources: [
      {
        '@id': `${baseUrl}/package/`,
        '@type': 'PackageBaseAddress/3.0.0',
        comment: `Base URL of where NuGet packages are stored, in the format ${baseUrl}/package/{id}/{version}/{id}.{version}.nupkg`
      },
      {
        '@id': `${baseUrl}/registrations/`,
        '@type': 'RegistrationsBaseUrl/3.0.0',
        comment: 'Base URL of NuGet package registration info'
      }
    ]
  };
}

router.get('/index.json', (req: Request, res: Response) => {
  const baseUrl = req.baseUrl;
  
  const serviceIndex = createServiceIndex(baseUrl);
  res.json(serviceIndex);
});

// Redirect root API path to index.json for convenience
router.get('/', (req: Request, res: Response) => {
  res.redirect(301, '/api/index.json');
});

// Handle trailing slash
router.get('/index.json/', (req: Request, res: Response) => {
  res.redirect(301, '/api/index.json');
});

export { router as serviceIndexRouter };
