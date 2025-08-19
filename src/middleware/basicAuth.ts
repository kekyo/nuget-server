// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Request, Response, NextFunction } from 'express';
import { HtpasswdUser, verifyPassword } from '../utils/htpasswd';
import { Logger } from '../types';

/**
 * Basic authentication middleware configuration
 */
export interface BasicAuthConfig {
  realm?: string;
  users: Map<string, HtpasswdUser>;
  logger: Logger;
}

/**
 * Creates Basic authentication middleware
 * @param config - Authentication configuration
 * @returns Express middleware function
 */
export const createBasicAuthMiddleware = (config: BasicAuthConfig) => {
  const realm = config.realm || 'NuGet Server';
  
  return async (req: Request, res: Response, next: NextFunction) => {
    const timestamp = new Date().toISOString();
    const authHeader = req.headers.authorization;
    
    config.logger.debug(`[${timestamp}] Auth check for ${req.method} ${req.path} - Users available: ${config.users.size}`);
    
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      config.logger.debug(`[${timestamp}] No Basic auth header provided`);
      return sendUnauthorized(res, realm);
    }
    
    try {
      // Decode Basic auth credentials
      const credentials = authHeader.substring(6); // Remove 'Basic ' prefix
      const decodedCredentials = Buffer.from(credentials, 'base64').toString('utf-8');
      const colonIndex = decodedCredentials.indexOf(':');
      
      if (colonIndex === -1) {
        config.logger.warn('Basic auth: Invalid credentials format');
        return sendUnauthorized(res, realm);
      }
      
      const username = decodedCredentials.substring(0, colonIndex);
      const password = decodedCredentials.substring(colonIndex + 1);
      
      if (!username || !password) {
        config.logger.warn(`[${timestamp}] Basic auth: Empty username or password`);
        return sendUnauthorized(res, realm);
      }
      
      config.logger.debug(`[${timestamp}] Basic auth: Attempting authentication for user: ${username}`);
      
      // Look up user
      const user = config.users.get(username);
      if (!user) {
        config.logger.warn(`[${timestamp}] Basic auth: User not found: ${username} (available users: ${Array.from(config.users.keys()).join(', ')})`);
        return sendUnauthorized(res, realm);
      }
      
      config.logger.debug(`[${timestamp}] Basic auth: Found user ${username} with ${user.hashType} hash`);
      
      // Verify password
      const isValid = await verifyPassword(password, user);
      if (!isValid) {
        config.logger.warn(`[${timestamp}] Basic auth: Invalid password for user: ${username}`);
        return sendUnauthorized(res, realm);
      }
      
      // Authentication successful
      config.logger.debug(`[${timestamp}] Basic auth: Successfully authenticated user: ${username}`);
      (req as any).user = { username };
      next();
      
    } catch (error) {
      config.logger.error(`[${timestamp}] Basic auth error: ${error}`);
      return sendUnauthorized(res, realm);
    }
  };
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
 * Creates a middleware that skips authentication if no users are configured
 * @param config - Authentication configuration
 * @returns Express middleware function that conditionally applies authentication
 */
export const createOptionalBasicAuthMiddleware = (config: BasicAuthConfig) => {
  // If no users configured, skip authentication
  if (config.users.size === 0) {
    return (req: Request, _res: Response, next: NextFunction) => {
      const timestamp = new Date().toISOString();
      config.logger.debug(`[${timestamp}] No auth required for ${req.method} ${req.path} - no users configured`);
      next();
    };
  }
  
  // Otherwise, use normal Basic auth
  return createBasicAuthMiddleware(config);
};