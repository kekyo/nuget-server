// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './api/index';
import { name as packageName, version, git_commit_hash } from './generated/packageMetadata';
import { createMetadataService } from './services/metadataService';
import { createAuthService } from './services/authService';
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

  // Initialize authentication service
  const authService = createAuthService({
    configDir: config.configDir || './',
    logger
  });
  
  try {
    await authService.initialize();
  } catch (error) {
    logger.error(`Failed to initialize auth service: ${error}`);
    throw error;
  }

  // Create API router with all dependencies
  const realm = config.realm || `${packageName} ${version}`;
  const apiRouterInstance = apiRouter(logger, metadataService, packagesRoot, authService, realm, config.configDir);

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
    app.get('/api/config', (_req, res) => {
      res.json({
        realm: realm,
        name: packageName,
        version: version,
        git_commit_hash: git_commit_hash,
        addSourceCommand: addSourceCommand
      });
    });

    // Serve UI at root path
    app.get('/', (_req, res) => {
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
      // Ensure auth service is fully initialized before reporting status
      await authService.waitForInitialization();
      
      logger.info(`Listening on port ${config.port}`);

      logger.info(`Example register command: ${addSourceCommand}`);

      if (authService.isPublishAuthEnabled()) {
        logger.info(`Publish authentication: enabled (${authService.getPublishUsers().size} users)`);
      } else {
        logger.info('Publish authentication: disabled (no htpasswd-publish file)');
      }
      
      if (authService.isGeneralAuthEnabled()) {
        logger.info(`General authentication: enabled (${authService.getGeneralUsers().size} users)`);
      } else {
        logger.info('General authentication: disabled (no htpasswd file)');
      }
      
      const serverInstance: ServerInstance = {
        close: () => {
          return new Promise<void>((closeResolve) => {
            server.close(() => {
              authService.destroy();
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
        authService.destroy();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  });
}
