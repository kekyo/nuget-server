// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './api/index';
import { name as packageName, version, git_commit_hash } from './generated/packageMetadata';
import { createMetadataService } from './services/metadataService';
import { createAuthService } from './services/authService';
import { createUserService } from './services/userService';
import { createSessionService } from './services/sessionService';
import { Logger, ServerConfig } from './types';
import { createUrlResolver } from './utils/urlResolver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Server instance with cleanup functionality
 */
export interface ServerInstance {
  close: () => Promise<void>;
}

/**
 * Starts the NuGet server with the provided configuration
 * @param config - Server configuration including port, baseUrl, and trusted proxies
 * @param logger - Logger instance for logging server events
 * @returns Promise that resolves to server instance when server is started
 */
export const startServer = async (config: ServerConfig, logger: Logger): Promise<ServerInstance> => {
  const app = express();

  // Initialize URL resolver
  const urlResolver = createUrlResolver({
    baseUrl: config.baseUrl,
    trustedProxies: config.trustedProxies
  });

  // Initialize metadata service
  const packagesRoot = config.packageDir || (process.cwd() + '/packages');
  const initialBaseUrl = config.baseUrl || `http://localhost:${config.port}/api`;
  const metadataService = createMetadataService(packagesRoot, initialBaseUrl, logger);
  
  try {
    await metadataService.initialize();
  } catch (error) {
    logger.error(`Failed to initialize metadata service: ${error}`);
    throw error;
  }

  // Initialize authentication service (for auth mode checking)
  const authService = createAuthService({
    authMode: config.authMode || 'none',
    logger
  });

  // Initialize user service (new authentication system)
  const userService = createUserService({
    configDir: config.configDir || './',
    logger
  });
  
  try {
    await userService.initialize();
  } catch (error) {
    logger.error(`Failed to initialize user service: ${error}`);
    throw error;
  }

  // Initialize session service
  const sessionService = createSessionService({
    logger
  });
  
  try {
    sessionService.initialize();
  } catch (error) {
    logger.error(`Failed to initialize session service: ${error}`);
    throw error;
  }

  // Create API router with all dependencies
  const realm = config.realm || `${packageName} ${version}`;
  const apiRouterInstance = apiRouter(logger, metadataService, packagesRoot, authService, userService, sessionService, realm, config.configDir);

  // Generate the add source command example (same logic as in server startup logs)
  let addSourceCommand: string;
  if (config.baseUrl) {
    addSourceCommand = `dotnet nuget add source "${config.baseUrl}/api/index.json" -n "ref1"${config.baseUrl.startsWith('https:') ? '' : ' --allow-insecure-connections'}`;
  } else {
    addSourceCommand = `dotnet nuget add source "http://localhost:${config.port}/api/index.json" -n "ref1" --allow-insecure-connections`;
  }

  // Add request logging middleware
  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
  });

  app.use(express.json());
  app.use(cookieParser());
  
  // URL resolution middleware
  app.use('/api', (req, _res, next) => {
    const { baseUrl } = urlResolver.resolveUrl(req);
    req.baseUrl = baseUrl;
    
    if (!urlResolver.isFixedUrl()) {
      metadataService.updateBaseUrl(baseUrl);
    }
    
    next();
  });
  
  app.use('/api', apiRouterInstance);

  if (!config.noUi) {
    // Serve static UI files
    const uiPath = path.join(__dirname, 'ui');
    app.use(express.static(uiPath));

    // Serve images from project root
    const imagesPath = path.join(__dirname, '..', 'images');
    app.use('/images', express.static(imagesPath));

    // Favicon is served by the UI static files (from public directory)

    // API endpoint to get server configuration for UI
    app.get('/api/config', async (req, res) => {
      // Check if user is authenticated by examining session or Basic auth
      let currentUser = null;
      
      try {
        // Check session authentication first (Cookie-based)
        const sessionToken = req.cookies?.sessionToken;
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
          const authHeader = req.headers.authorization;
          if (authHeader && authHeader.startsWith('Basic ')) {
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
        logger.error(`Error checking authentication for /api/config: ${error}`);
      }
      
      res.json({
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
      });
    });

    // Serve login page
    app.get('/login', (req, res) => {
      const uiPath = path.join(__dirname, 'ui');
      res.sendFile(path.join(uiPath, 'login.html'));
    });

    // Serve UI at root path
    app.get('/', async (req, res) => {
      const authMode = authService.getAuthMode();
      
      // If authMode is 'full', check if user is authenticated
      if (authMode === 'full') {
        let isAuthenticated = false;
        
        try {
          // Check session authentication
          const sessionToken = req.cookies?.sessionToken;
          if (sessionToken) {
            const session = sessionService.validateSession(sessionToken);
            if (session) {
              isAuthenticated = true;
            }
          }
          
          // If no session, check Basic authentication
          if (!isAuthenticated) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Basic ')) {
              const credentials = authHeader.substring(6);
              const decodedCredentials = Buffer.from(credentials, 'base64').toString('utf-8');
              const colonIndex = decodedCredentials.indexOf(':');
              
              if (colonIndex !== -1) {
                const username = decodedCredentials.substring(0, colonIndex);
                const password = decodedCredentials.substring(colonIndex + 1);
                
                const user = await userService.validateApiKey(username, password);
                if (user) {
                  isAuthenticated = true;
                }
              }
            }
          }
        } catch (error) {
          logger.error(`Error checking authentication for root path: ${error}`);
        }
        
        if (!isAuthenticated) {
          return res.redirect('/login');
        }
      }
      
      const uiPath = path.join(__dirname, 'ui');
      res.sendFile(path.join(uiPath, 'index.html'));
    });
  } else {
    // When UI is disabled, return JSON at root path
    app.get('/', (_req, res) => {
      res.json({
        message: realm,
        apiEndpoint: '/api'
      });
    });
  }

  return new Promise((resolve) => {
    const server = app.listen(config.port, async () => {
      logger.info(`Listening on port ${config.port}`);

      logger.info(`Example register command: ${addSourceCommand}`);
      logger.info(`Authentication mode: ${authService.getAuthMode()}`);

      const userCount = await userService.getUserCount();

      if (authService.isAuthRequired('publish')) {
        logger.info(`Publish authentication: enabled (${userCount} users)`);
      } else {
        logger.info('Publish authentication: disabled');
      }
      
      if (authService.isAuthRequired('general')) {
        logger.info(`General authentication: enabled (${userCount} users)`);
      } else {
        logger.info('General authentication: disabled');
      }

      if (authService.isAuthRequired('admin')) {
        logger.info(`Admin authentication: enabled (${userCount} users)`);
      } else {
        logger.info('Admin authentication: disabled');
      }
      
      const serverInstance: ServerInstance = {
        close: () => {
          return new Promise<void>((closeResolve) => {
            server.close(() => {
              userService.destroy();
              sessionService.destroy();
              closeResolve();
            });
          });
        }
      };
      
      resolve(serverInstance);
    });

    // Graceful shutdown for CLI usage
    const gracefulShutdown = () => {
      logger.info('Shutting down server...');
      server.close(() => {
        userService.destroy();
        sessionService.destroy();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  });
}
