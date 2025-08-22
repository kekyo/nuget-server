// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Request, Response, NextFunction } from 'express';
import { Logger } from '../types';
import { UserService } from '../services/userService';
import { SessionService } from '../services/sessionService';

/**
 * Hybrid authentication middleware configuration
 */
export interface HybridAuthConfig {
  realm?: string;
  userService: UserService;
  sessionService: SessionService;
  logger: Logger;
}

/**
 * Extended request interface with user information
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    username: string;
    role: string;
  };
}

/**
 * Checks if the request is from a UI (browser) based on Accept header
 * @param req - Express request
 * @returns True if request appears to be from UI
 */
const isUIRequest = (req: Request): boolean => {
  const acceptHeader = req.headers.accept || '';
  // Only consider requests specifically asking for HTML as UI requests
  // Don't treat generic */*, application/json or other API content types as UI requests
  return acceptHeader.includes('text/html') && !acceptHeader.includes('application/json');
};

/**
 * Parses Basic authentication header
 * @param authHeader - Authorization header value
 * @returns Parsed credentials or null
 */
const parseBasicAuth = (authHeader: string): { username: string; password: string } | null => {
  try {
    if (!authHeader.startsWith('Basic ')) {
      return null;
    }

    const credentials = authHeader.substring(6); // Remove 'Basic ' prefix
    const decodedCredentials = Buffer.from(credentials, 'base64').toString('utf-8');
    const colonIndex = decodedCredentials.indexOf(':');

    if (colonIndex === -1) {
      return null;
    }

    const username = decodedCredentials.substring(0, colonIndex);
    const password = decodedCredentials.substring(colonIndex + 1);

    if (!username || !password) {
      return null;
    }

    return { username, password };
  } catch (error) {
    return null;
  }
};

/**
 * Sends 401 Unauthorized response with WWW-Authenticate header
 * @param res - Express response object
 * @param realm - Authentication realm
 */
const sendUnauthorized = (res: Response, realm: string) => {
  res.set('WWW-Authenticate', `Basic realm="${realm}"`);
  res.status(401).json({
    error: 'Authentication required',
    message: 'Please provide valid credentials'
  });
};

/**
 * Creates hybrid authentication middleware that supports both session and Basic auth
 * @param config - Authentication configuration
 * @returns Express middleware function
 */
export const createHybridAuthMiddleware = (config: HybridAuthConfig) => {
  const realm = config.realm || 'NuGet Server';
  const { userService, sessionService, logger } = config;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    logger.debug(`Hybrid auth check for ${req.method} ${req.path}`);

    try {
      // 1. Check session authentication (Cookie-based, for UI)
      const sessionToken = req.cookies?.sessionToken;
      if (sessionToken) {
        logger.debug('Checking session authentication');
        const session = sessionService.validateSession(sessionToken);
        if (session) {
          logger.debug(`Session auth successful for user: ${session.username}`);
          req.user = {
            username: session.username,
            role: session.role
          };
          return next();
        } else {
          logger.debug('Invalid or expired session token');
          // Clear invalid session cookie
          res.clearCookie('sessionToken', {
            httpOnly: true,
            secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
            sameSite: 'strict',
            path: '/'
          });
        }
      }

      // 2. Check Basic authentication (for API clients)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Basic ')) {
        logger.debug('Checking Basic authentication');
        const credentials = parseBasicAuth(authHeader);
        
        if (credentials) {
          const user = await userService.validateApiKey(credentials.username, credentials.password);
          if (user) {
            logger.debug(`Basic auth successful for user: ${user.username}`);
            req.user = {
              username: user.username,
              role: user.role
            };
            return next();
          } else {
            logger.warn(`Basic auth failed for user: ${credentials.username}`);
          }
        } else {
          logger.warn('Invalid Basic auth header format');
        }
      }

      // 3. Authentication failed
      logger.debug(`Authentication failed for ${req.method} ${req.path}`);
      
      if (isUIRequest(req)) {
        // For UI requests, redirect to login page
        logger.debug('Redirecting UI request to login');
        return res.redirect('/login');
      } else {
        // For API requests, send 401 with WWW-Authenticate header
        logger.debug('Sending 401 for API request');
        return sendUnauthorized(res, realm);
      }

    } catch (error) {
      logger.error(`Hybrid auth error: ${error}`);
      return res.status(500).json({
        error: 'Authentication error',
        message: 'Internal server error during authentication'
      });
    }
  };
};

/**
 * Creates a conditional hybrid authentication middleware
 * @param config - Authentication configuration
 * @param skipAuth - If true, skip authentication regardless of configuration
 * @returns Express middleware function that conditionally applies authentication
 */
export const createConditionalHybridAuthMiddleware = (config: HybridAuthConfig, skipAuth: boolean = false) => {
  // If authentication should be skipped, always skip
  if (skipAuth) {
    return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      config.logger.debug(`Hybrid auth skipped for ${req.method} ${req.path} - disabled by configuration`);
      next();
    };
  }

  // Use hybrid auth when not skipped
  return createHybridAuthMiddleware(config);
};

/**
 * Creates a role-based authorization middleware
 * @param requiredRoles - Array of required roles (user must have at least one)
 * @param logger - Logger instance
 * @returns Express middleware function
 */
export const createRoleAuthorizationMiddleware = (requiredRoles: string[], logger: Logger) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      logger.warn(`Authorization failed - no user information in request`);
      return res.status(401).json({
        error: 'Authentication required',
        message: 'User must be authenticated'
      });
    }

    const userRole = req.user.role;
    const hasRequiredRole = requiredRoles.includes(userRole) || 
                           (requiredRoles.includes('read') && ['publish', 'admin'].includes(userRole)) ||
                           (requiredRoles.includes('publish') && userRole === 'admin');

    if (!hasRequiredRole) {
      logger.warn(`Authorization failed for user: ${req.user.username} (role: ${userRole}, required: ${requiredRoles.join(', ')})`);
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Required role: ${requiredRoles.join(' or ')}`
      });
    }

    logger.debug(`Authorization successful for user: ${req.user.username} (role: ${userRole})`);
    next();
  };
};