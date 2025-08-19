// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response, NextFunction } from 'express';
import { Logger } from '../types';
import { MetadataService } from '../services/metadataService';
import { AuthService } from '../services/authService';
import { createOptionalBasicAuthMiddleware } from '../middleware/basicAuth';
import { serviceIndexRouter } from './serviceIndex';
import { createPackageContentRouter } from './packageContent';
import { createRegistrationsRouter } from './registrations';
import { createPublishRouter } from './publish';

/**
 * Creates and configures the main API router with all endpoints
 * @param logger - Logger instance for logging API events
 * @param metadataService - Metadata service for package information management
 * @param packagesRoot - Root directory for package storage
 * @param authService - Authentication service for Basic auth
 * @returns Configured Express router with all API endpoints
 */
export const apiRouter = (logger: Logger, metadataService: MetadataService, packagesRoot: string, authService: AuthService) => {
  const router = Router();

  const registrationsRouterInfo = createRegistrationsRouter(logger);
  registrationsRouterInfo.setMetadataService(metadataService);

  const publishRouterInfo = createPublishRouter(logger, packagesRoot);
  publishRouterInfo.setPackageUploadService(metadataService);

  const packageContentRouterInfo = createPackageContentRouter(logger, packagesRoot);
  packageContentRouterInfo.setPackageContentMetadataService(metadataService);

  // Create authentication middlewares that dynamically get users
  const publishAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const middleware = createOptionalBasicAuthMiddleware({
      realm: 'NuGet Server - Publish',
      users: authService.getPublishUsers(),
      logger
    });
    return middleware(req, res, next);
  };

  const generalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const middleware = createOptionalBasicAuthMiddleware({
      realm: 'NuGet Server',
      users: authService.getGeneralUsers(),
      logger
    });
    return middleware(req, res, next);
  };

  // Apply general authentication to service index, package downloads and registrations
  router.use('/', generalAuthMiddleware, serviceIndexRouter);
  router.use('/package', generalAuthMiddleware, packageContentRouterInfo.router);
  router.use('/registrations', generalAuthMiddleware, registrationsRouterInfo.router);
  
  // Apply publish authentication to publish endpoint
  router.use('/publish', publishAuthMiddleware, publishRouterInfo.router);

  return router;
};
