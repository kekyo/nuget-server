// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response, NextFunction } from 'express';
import { Logger } from '../types';
import { MetadataService } from '../services/metadataService';
import { AuthService } from '../services/authService';
import { UserService } from '../services/userService';
import { SessionService } from '../services/sessionService';
import { createConditionalHybridAuthMiddleware, createRoleAuthorizationMiddleware } from '../middleware/hybridAuth';
import { serviceIndexRouter } from './serviceIndex';
import { createPackageContentRouter } from './packageContent';
import { createRegistrationsRouter } from './registrations';
import { createPublishRouter } from './publish';
import { createSearchRouter } from './search';
import { createUserAddRouter } from './useradd';
import { createAuthRouter } from './auth';

/**
 * Creates and configures the main API router with all endpoints
 * @param logger - Logger instance for logging API events
 * @param metadataService - Metadata service for package information management
 * @param packagesRoot - Root directory for package storage
 * @param authService - Authentication service (legacy, for auth mode checking)
 * @param userService - User service for new authentication system
 * @param sessionService - Session service for new authentication system
 * @param realm - Authentication realm for Basic auth challenges
 * @param configDir - Configuration directory
 * @returns Configured Express router with all API endpoints
 */
export const apiRouter = (
  logger: Logger, 
  metadataService: MetadataService, 
  packagesRoot: string, 
  authService: AuthService, 
  userService: UserService,
  sessionService: SessionService,
  realm: string, 
  configDir: string
) => {
  const router = Router();

  const registrationsRouterInfo = createRegistrationsRouter(logger);
  registrationsRouterInfo.setMetadataService(metadataService);

  const publishRouterInfo = createPublishRouter(logger, packagesRoot);
  publishRouterInfo.setPackageUploadService(metadataService);

  const packageContentRouterInfo = createPackageContentRouter(logger, packagesRoot);
  packageContentRouterInfo.setPackageContentMetadataService(metadataService);

  const searchRouterInfo = createSearchRouter(logger);
  searchRouterInfo.setMetadataService(metadataService);

  const userAddRouterInfo = createUserAddRouter(logger);
  userAddRouterInfo.setConfigDir(configDir);
  userAddRouterInfo.setUserService(userService);

  // Create authentication router
  const authRouterInfo = createAuthRouter(logger);
  authRouterInfo.setUserService(userService);
  authRouterInfo.setSessionService(sessionService);

  // Create hybrid authentication middlewares that support both session and Basic auth
  const generalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const skipAuth = !authService.isAuthRequired('general');
    const middleware = createConditionalHybridAuthMiddleware({
      realm: realm,
      userService,
      sessionService,
      logger
    }, skipAuth);
    return middleware(req, res, next);
  };

  const publishAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const skipAuth = !authService.isAuthRequired('publish');
    if (skipAuth) {
      return next();
    }
    
    const hybridAuthMiddleware = createConditionalHybridAuthMiddleware({
      realm: `${realm} - Publish`,
      userService,
      sessionService,
      logger
    }, false);
    
    const roleAuthMiddleware = createRoleAuthorizationMiddleware(['publish', 'admin'], logger);
    
    return hybridAuthMiddleware(req, res, (err?: any) => {
      if (err) return next(err);
      return roleAuthMiddleware(req, res, next);
    });
  };

  const adminAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const skipAuth = !authService.isAuthRequired('admin');
    if (skipAuth) {
      logger.debug(`Admin auth skipped for ${req.method} ${req.path} - disabled by configuration`);
      return next();
    }
    
    const hybridAuthMiddleware = createConditionalHybridAuthMiddleware({
      realm: `${realm} - Admin`,
      userService,
      sessionService,
      logger
    }, false);
    
    const roleAuthMiddleware = createRoleAuthorizationMiddleware(['admin'], logger);
    
    return hybridAuthMiddleware(req, res, (err?: any) => {
      if (err) return next(err);
      return roleAuthMiddleware(req, res, next);
    });
  };

  // Apply general authentication to service index, package downloads and registrations
  router.use('/', generalAuthMiddleware, serviceIndexRouter);
  router.use('/package', generalAuthMiddleware, packageContentRouterInfo.router);
  router.use('/registrations', generalAuthMiddleware, registrationsRouterInfo.router);
  router.use('/search', generalAuthMiddleware, searchRouterInfo.router);
  
  // Apply publish authentication to publish endpoint
  router.use('/publish', publishAuthMiddleware, publishRouterInfo.router);
  
  // Apply admin authentication to user management endpoint
  router.use('/useradd', adminAuthMiddleware, userAddRouterInfo.router);

  // Add authentication endpoints
  router.use('/auth', authRouterInfo.router);

  return router;
};
