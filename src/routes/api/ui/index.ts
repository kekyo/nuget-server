// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Logger } from '../../../types';
import { UserService } from '../../../services/userService';
import { SessionService } from '../../../services/sessionService';
import { AuthService } from '../../../services/authService';
import { createPackageService } from '../../../services/packageService';
import { AuthenticatedFastifyRequest } from '../../../middleware/fastifyAuth';
import { name as packageName, version, git_commit_hash } from '../../../generated/packageMetadata';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Configuration for UI routes
 */
export interface UiRoutesConfig {
  userService: UserService;
  sessionService: SessionService;
  authService: AuthService;
  packagesRoot: string;
  logger: Logger;
  realm: string;
  addSourceCommand: string;
}

/**
 * POST /api/ui/config request body (empty object)
 */
export interface ConfigRequest {
  // Empty object for consistency
}

/**
 * POST /api/ui/config response
 */
export interface ConfigResponse {
  realm: string;
  name: string;
  version: string;
  git_commit_hash: string;
  addSourceCommand: string;
  authMode: string;
  authEnabled: {
    general: boolean;
    publish: boolean;
    admin: boolean;
  };
  currentUser: {
    username: string;
    role: string;
    authenticated: boolean;
  } | null;
}

/**
 * POST /api/ui/users request body for user management
 */
export interface UserManagementRequest {
  action: 'list' | 'create' | 'delete';
  username?: string;
  password?: string;
  role?: 'admin' | 'publish' | 'read';
}

/**
 * User list response
 */
export interface UserListResponse {
  users: Array<{
    id: string;
    username: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

/**
 * User creation response
 */
export interface UserCreateResponse {
  user: {
    id: string;
    username: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
  apiKey: string;
}

/**
 * User deletion response
 */
export interface UserDeleteResponse {
  success: boolean;
  message: string;
}

/**
 * API key regeneration request (empty for current user)
 */
export interface ApiKeyRegenerateRequest {
  // Empty object - regenerates API key for current user
}

/**
 * API key regeneration response
 */
export interface ApiKeyRegenerateResponse {
  apiKey: string;
  username: string;
}

/**
 * Password change request
 */
export interface PasswordChangeRequest {
  currentPassword?: string; // Required for self password change
  newPassword: string;
  username?: string; // For admin changing other user's password
}

/**
 * Password change response
 */
export interface PasswordChangeResponse {
  success: boolean;
  message: string;
}

/**
 * Session-only authentication middleware
 */
const createSessionOnlyAuthMiddleware = (sessionService: SessionService, logger: Logger) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionToken = request.cookies?.sessionToken;
    
    if (!sessionToken) {
      return reply.status(401).send({ error: 'Session authentication required' });
    }
    
    const session = sessionService.validateSession(sessionToken);
    if (!session) {
      return reply.status(401).send({ error: 'Invalid or expired session' });
    }
    
    // Add user info to request
    (request as any).user = {
      id: session.userId,
      username: session.username,
      role: session.role
    };
    
    logger.info(`Session auth successful: ${session.username} (${session.role})`);
  };
};

/**
 * Role-based authorization helper
 */
const requireRole = (request: AuthenticatedFastifyRequest, reply: FastifyReply, roles: string[]) => {
  if (!request.user || !roles.includes(request.user.role)) {
    return reply.status(403).send({ error: 'Insufficient permissions' });
  }
};

/**
 * Registers UI Backend API routes with Fastify instance
 */
export const registerUiRoutes = async (fastify: FastifyInstance, config: UiRoutesConfig) => {
  const { userService, sessionService, authService, packagesRoot, logger, realm, addSourceCommand } = config;
  const packageService = createPackageService(packagesRoot);
  
  // Create session-only auth middleware
  const sessionOnlyAuth = createSessionOnlyAuthMiddleware(sessionService, logger);

  // POST /api/ui/config - Application configuration (public endpoint)
  fastify.post('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let currentUser = null;
      
      try {
        // Check session authentication first (Cookie-based)
        const sessionToken = request.cookies?.sessionToken;
        if (sessionToken) {
          const session = sessionService.validateSession(sessionToken);
          if (session) {
            currentUser = {
              username: session.username,
              role: session.role,
              authenticated: true
            };
          }
        }
        
        // If no session, check Basic authentication (API clients)
        if (!currentUser) {
          const authHeader = request.headers.authorization;
          if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Basic ')) {
            const credentials = authHeader.substring(6);
            const decodedCredentials = Buffer.from(credentials, 'base64').toString('utf-8');
            const colonIndex = decodedCredentials.indexOf(':');
            
            if (colonIndex !== -1) {
              const username = decodedCredentials.substring(0, colonIndex);
              const password = decodedCredentials.substring(colonIndex + 1);
              
              const user = await userService.validateApiKey(username, password);
              if (user) {
                currentUser = {
                  username: user.username,
                  role: user.role,
                  authenticated: true
                };
              }
            }
          }
        }
      } catch (error) {
        logger.error(`Error checking authentication for /api/ui/config: ${error}`);
      }
      
      const response: ConfigResponse = {
        realm: realm,
        name: packageName,
        version: version,
        git_commit_hash: git_commit_hash,
        addSourceCommand: addSourceCommand,
        authMode: authService.getAuthMode(),
        authEnabled: {
          general: authService.isAuthRequired('general'),
          publish: authService.isAuthRequired('publish'),
          admin: authService.isAuthRequired('admin')
        },
        currentUser: currentUser
      };

      return reply.send(response);
    } catch (error) {
      logger.error(`Error in /api/ui/config: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/ui/users - User management (admin permission required)
  fastify.post('/users', {
    preHandler: [sessionOnlyAuth]
  }, async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    try {
      // All user management operations require admin role
      const roleCheck = requireRole(request, reply, ['admin']);
      if (roleCheck) return roleCheck;
      
      const body = request.body as UserManagementRequest;
      
      switch (body.action) {
        case 'list': {
          const users = await userService.getAllUsers();
          
          const response: UserListResponse = {
            users: users.map(user => ({
              id: user.id,
              username: user.username,
              role: user.role,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt
            }))
          };
          
          return reply.send(response);
        }
        
        case 'create': {
          if (!body.username || !body.password || !body.role) {
            return reply.status(400).send({ error: 'Username, password, and role are required' });
          }
          
          logger.info(`Creating new user: ${body.username} with role: ${body.role}`);
          
          const result = await userService.createUser({
            username: body.username,
            password: body.password,
            role: body.role
          });
          
          logger.info(`User ${body.username} created successfully`);
          
          const response: UserCreateResponse = {
            user: {
              id: result.user.id,
              username: result.user.username,
              role: result.user.role,
              createdAt: result.user.createdAt,
              updatedAt: result.user.updatedAt
            },
            apiKey: result.apiKey
          };
          
          return reply.status(201).send(response);
        }
        
        case 'delete': {
          if (!body.username) {
            return reply.status(400).send({ error: 'Username is required' });
          }
          
          logger.info(`Deleting user: ${body.username}`);
          
          const deleted = await userService.deleteUser(body.username);
          if (!deleted) {
            return reply.status(404).send({ error: 'User not found' });
          }
          
          logger.info(`User ${body.username} deleted successfully`);
          
          const response: UserDeleteResponse = {
            success: true,
            message: 'User deleted successfully'
          };
          
          return reply.send(response);
        }
        
        default:
          return reply.status(400).send({ error: `Unknown action: ${body.action}` });
      }
    } catch (error) {
      if (error.statusCode) {
        throw error; // Re-throw HTTP errors
      }
      logger.error(`Error in /api/ui/users: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/ui/apikey - Regenerate API key for current user (session auth required)
  fastify.post('/apikey', {
    preHandler: [sessionOnlyAuth]
  }, async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    try {
      logger.info(`Regenerating API key for user: ${request.user.username}`);
      
      const result = await userService.regenerateApiKey(request.user.username);
      if (!result) {
        return reply.status(404).send({ error: 'User not found' });
      }
      
      logger.info(`API key regenerated successfully for user: ${request.user.username}`);
      
      const response: ApiKeyRegenerateResponse = {
        apiKey: result.apiKey,
        username: request.user.username
      };
      
      return reply.send(response);
    } catch (error) {
      if (error.statusCode) {
        throw error; // Re-throw HTTP errors
      }
      logger.error(`Error in /api/ui/apikey: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/ui/password - Change password (session auth required)
  fastify.post('/password', {
    preHandler: [sessionOnlyAuth]
  }, async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as PasswordChangeRequest;
      
      if (!body.newPassword) {
        return reply.status(400).send({ error: 'New password is required' });
      }
      
      if (body.username) {
        // Admin changing another user's password
        const roleCheck = requireRole(request, reply, ['admin']);
        if (roleCheck) return roleCheck;
        
        logger.info(`Admin ${request.user.username} changing password for user: ${body.username}`);
        
        const updated = await userService.updateUser(body.username, { password: body.newPassword });
        if (!updated) {
          return reply.status(404).send({ error: 'User not found' });
        }
        
        logger.info(`Password changed successfully for user: ${body.username}`);
      } else {
        // User changing their own password
        if (!body.currentPassword) {
          return reply.status(400).send({ error: 'Current password is required for self password change' });
        }
        
        // Validate current password
        const user = await userService.validateCredentials(request.user.username, body.currentPassword);
        if (!user) {
          return reply.status(401).send({ error: 'Current password is incorrect' });
        }
        
        logger.info(`User ${request.user.username} changing their own password`);
        
        const updated = await userService.updateUser(request.user.username, { password: body.newPassword });
        if (!updated) {
          return reply.status(404).send({ error: 'User not found' });
        }
        
        logger.info(`Password changed successfully for user: ${request.user.username}`);
      }
      
      const response: PasswordChangeResponse = {
        success: true,
        message: 'Password updated successfully'
      };
      
      return reply.send(response);
    } catch (error) {
      if (error.statusCode) {
        throw error; // Re-throw HTTP errors
      }
      logger.error(`Error in /api/ui/password: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/ui/icon/{id}/{version} - Package icon (auth requirements based on authMode)
  fastify.get('/icon/:id/:version', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      const authMode = authService.getAuthMode();
      if (authMode === 'full') {
        // For full auth mode, require session authentication
        return sessionOnlyAuth(request, reply);
      }
      // For 'none' and 'publish' modes, no authentication required
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: packageId, version } = request.params as { id: string; version: string };
    
    try {
      logger.info(`Serving icon for package: ${packageId} ${version}`);
      
      // Try to get icon from package metadata or storage
      const lowerVersion = version.toLowerCase();
      
      // Look for icon file in package directory (preserve original packageId case)
      const packageDir = join(packagesRoot, packageId, lowerVersion);
      const iconExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
      
      for (const ext of iconExtensions) {
        try {
          const iconPath = join(packageDir, `icon.${ext}`);
          await fs.access(iconPath); // Check if file exists
          
          // Set appropriate content type
          const contentType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
          reply.header('Content-Type', contentType);
          reply.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
          
          // Read and send the file
          const iconData = await fs.readFile(iconPath);
          logger.info(`Icon served successfully: ${packageId} ${version}`);
          return reply.send(iconData);
        } catch (error) {
          // Continue to next extension
        }
      }
      
      // Icon not found
      logger.warn(`Icon not found for package: ${packageId} ${version}`);
      return reply.status(404).send({ error: 'Icon not found' });
    } catch (error) {
      logger.error(`Error serving icon for ${packageId} ${version}: ${error}`);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  logger.info('UI Backend API routes registered successfully');
};