// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyPassport from '@fastify/passport';
import fastifySecureSession from '@fastify/secure-session';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { name as packageName, version, git_commit_hash } from './generated/packageMetadata';
import { createMetadataService } from './services/metadataService';
import { createAuthService } from './services/authService';
import { createUserService } from './services/userService';
import { createSessionService } from './services/sessionService';
import { Logger, ServerConfig } from './types';
import { createUrlResolver } from './utils/urlResolver';
import { 
  createLocalStrategy, 
  createBasicStrategy,
  createHybridAuthMiddleware,
  createSessionOnlyAuthMiddleware,
  createConditionalHybridAuthMiddleware,
  createRoleAuthorizationMiddleware,
  FastifyAuthConfig,
  AuthenticatedFastifyRequest
} from './middleware/fastifyAuth';
import { registerV3Routes } from './routes/v3/index';
import { registerUiRoutes } from './routes/api/ui/index';
import { registerPublishRoutes } from './routes/api/publish/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Server instance with cleanup functionality
 */
export interface FastifyServerInstance {
  close: () => Promise<void>;
}

/**
 * Starts the NuGet server with Fastify framework
 * @param config - Server configuration including port, baseUrl, and trusted proxies
 * @param logger - Logger instance for logging server events
 * @returns Promise that resolves to server instance when server is started
 */
export const startFastifyServer = async (config: ServerConfig, logger: Logger): Promise<FastifyServerInstance> => {
  // Create Fastify instance with simple logging
  const fastify: FastifyInstance = Fastify({
    logger: {
      level: config.logLevel || 'info'
    },
    bodyLimit: 1024 * 1024 * 100, // 100MB limit for package uploads
    disableRequestLogging: true // Use our custom request logging
  });

  // Add content type parser for binary data (package uploads)
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

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

  // Configure secure session plugin with session decorator
  await fastify.register(fastifySecureSession, {
    key: Buffer.from('a'.repeat(32)), // TODO: Use proper secret key from config
    cookie: {
      path: '/',
      httpOnly: true,
      secure: false, // TODO: Set to true in production with HTTPS
      sameSite: 'strict' as const,
      maxAge: 86400000 // 24 hours
    }
  });

  // Configure Passport plugin (depends on session)
  await fastify.register(fastifyPassport.initialize());
  await fastify.register(fastifyPassport.secureSession());

  // Register static file plugin (provides sendFile method)
  await fastify.register(fastifyStatic, {
    root: '/', // This allows sending files from absolute paths
    serve: false // Disable automatic serving, use sendFile manually
  });

  // Create authentication configuration
  const authConfig: FastifyAuthConfig = {
    realm: config.realm || `${packageName} ${version}`,
    userService,
    sessionService,
    logger
  };

  // Configure Passport strategies
  const localStrategy = createLocalStrategy(authConfig);
  const basicStrategy = createBasicStrategy(authConfig);
  
  fastifyPassport.use('local', localStrategy);
  fastifyPassport.use('basic', basicStrategy);

  // Passport serialization for sessions
  fastifyPassport.registerUserSerializer(async (user: any) => user.id);
  fastifyPassport.registerUserDeserializer(async (id: string) => {
    // Get user from user service by ID
    const allUsers = await userService.getAllUsers();
    return allUsers.find(user => user.id === id) || null;
  });

  // Basic health check endpoint
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', serverType: 'fastify', version };
  });

  // Generate the add source command example (same logic as in Express server)
  let addSourceCommand: string;
  if (config.baseUrl) {
    addSourceCommand = `dotnet nuget add source "${config.baseUrl}/api/index.json" -n "ref1"${config.baseUrl.startsWith('https:') ? '' : ' --allow-insecure-connections'}`;
  } else {
    addSourceCommand = `dotnet nuget add source "http://localhost:${config.port}/api/index.json" -n "ref1" --allow-insecure-connections`;
  }

  if (!config.noUi) {
    // Authentication endpoints (must be accessible without authentication for login)
    fastify.post('/api/auth/login', async (request, reply) => {
      const { username, password, rememberMe } = request.body as any;
      
      try {
        const user = await userService.validateCredentials(username, password);
        if (!user) {
          return reply.status(401).send({
            success: false,
            message: 'Invalid credentials'
          });
        }

        // Create session
        const expirationHours = rememberMe ? 7 * 24 : 24; // 7 days or 24 hours
        const session = sessionService.createSession({
          userId: user.id,
          username: user.username,
          role: user.role,
          expirationHours: expirationHours
        });
        
        // Set session cookie
        reply.setCookie('sessionToken', session.token, {
          httpOnly: true,
          secure: request.protocol === 'https',
          sameSite: 'strict' as const,
          maxAge: expirationHours * 60 * 60 * 1000,
          path: '/'
        });

        return {
          success: true,
          user: {
            username: user.username,
            role: user.role
          }
        };
      } catch (error) {
        logger.error(`Login error: ${error}`);
        return reply.status(500).send({
          success: false,
          message: 'Internal server error'
        });
      }
    });

    fastify.post('/api/auth/logout', async (request, reply) => {
      const sessionToken = request.cookies?.sessionToken;
      
      if (sessionToken) {
        sessionService.deleteSession(sessionToken);
      }
      
      reply.clearCookie('sessionToken', {
        httpOnly: true,
        secure: request.protocol === 'https',
        sameSite: 'strict' as const,
        path: '/'
      });

      return {
        success: true,
        message: 'Logged out successfully'
      };
    });

    fastify.get('/api/auth/session', async (request, reply) => {
      const sessionToken = request.cookies?.sessionToken;
      
      if (!sessionToken) {
        return {
          authenticated: false,
          user: null
        };
      }

      const session = sessionService.validateSession(sessionToken);
      if (!session) {
        // Clear invalid session cookie
        reply.clearCookie('sessionToken', {
          httpOnly: true,
          secure: request.protocol === 'https',
          sameSite: 'strict' as const,
          path: '/'
        });
        
        return {
          authenticated: false,
          user: null
        };
      }

      return {
        authenticated: true,
        user: {
          username: session.username,
          role: session.role
        }
      };
    });

    // Serve config endpoint without authentication (public endpoint per CLAUDE.md spec)
    fastify.get('/api/config', async (request: FastifyRequest, reply) => {
      // Get current user from session if available
      let currentUser = null;
      
      // Check session for current user (but don't require authentication)
      try {
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
      } catch (error) {
        logger.error(`Error checking authentication for /api/config: ${error}`);
      }
      
      return {
        realm: config.realm || `${packageName} ${version}`,
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
        currentUser: currentUser,
        serverType: 'fastify'
      };
    });

    // Register V3 API routes
    try {
      await registerV3Routes(fastify, {
        metadataService,
        authService,
        authConfig,
        packagesRoot,
        logger
      });
    } catch (error) {
      logger.error(`Failed to register V3 routes: ${error}`);
      throw error;
    }

    // Register UI Backend API routes
    try {
      await fastify.register(async (fastify) => {
        await registerUiRoutes(fastify, {
          userService,
          sessionService,
          authService,
          packagesRoot,
          logger,
          realm: config.realm || `${packageName} ${version}`,
          addSourceCommand
        });
      }, { prefix: '/api/ui' });
    } catch (error) {
      logger.error(`Failed to register UI routes: ${error}`);
      throw error;
    }

    // Register Publish API routes
    try {
      let publishServiceSetter: any;
      await fastify.register(async (fastify) => {
        const publishRoutes = await registerPublishRoutes(fastify, {
          packagesRoot,
          authService,
          authConfig,
          logger
        });
        publishServiceSetter = publishRoutes.setPackageUploadService;
      }, { prefix: '/api' });
      
      // Set package upload service for publish functionality
      if (publishServiceSetter) {
        publishServiceSetter(metadataService);
      }
    } catch (error) {
      logger.error(`Failed to register Publish routes: ${error}`);
      throw error;
    }

    // Serve UI files with custom handler
    const uiPath = path.join(__dirname, 'ui');
    const imagesPath = path.join(__dirname, '..', 'images');
    
    // Helper function to serve static files using streaming
    const serveStaticFile = async (filePath: string, reply: any) => {
      try {
        if (!existsSync(filePath)) {
          throw new Error('File not found');
        }
        
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          throw new Error('Not a file');
        }
        
        // Get MIME type based on file extension
        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'application/octet-stream';
        
        switch (ext) {
          case '.html':
            contentType = 'text/html; charset=utf-8';
            break;
          case '.js':
            contentType = 'application/javascript; charset=utf-8';
            break;
          case '.css':
            contentType = 'text/css; charset=utf-8';
            break;
          case '.json':
            contentType = 'application/json; charset=utf-8';
            break;
          case '.png':
            contentType = 'image/png';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
          case '.svg':
            contentType = 'image/svg+xml';
            break;
          case '.ico':
            contentType = 'image/x-icon';
            break;
        }
        
        reply.header('Content-Type', contentType);
        
        return reply.sendFile(filePath);
      } catch (error) {
        reply.code(404).send({ error: 'File not found' });
      }
    };
    
    // Serve UI at root path
    fastify.get('/', async (request, reply) => {
      const indexPath = path.join(uiPath, 'index.html');
      return serveStaticFile(indexPath, reply);
    });
    
    // Serve login page
    fastify.get('/login', async (request, reply) => {
      const loginPath = path.join(uiPath, 'login.html');
      return serveStaticFile(loginPath, reply);
    });
    
    // Serve other UI assets
    fastify.get('/assets/*', async (request, reply) => {
      const assetPath = (request.params as any)['*'];
      const fullPath = path.join(uiPath, 'assets', assetPath);
      return serveStaticFile(fullPath, reply);
    });
    
    // Serve images
    fastify.get('/images/*', async (request, reply) => {
      const imagePath = (request.params as any)['*'];
      const fullPath = path.join(imagesPath, imagePath);
      return serveStaticFile(fullPath, reply);
    });
    
    // Serve favicon
    fastify.get('/favicon.ico', async (request, reply) => {
      const faviconPath = path.join(uiPath, 'favicon.ico');
      return serveStaticFile(faviconPath, reply);
    });
  } else {
    // When UI is disabled, return JSON at root path
    fastify.get('/', async (request, reply) => {
      return {
        message: config.realm || `${packageName} ${version}`,
        apiEndpoint: '/api',
        serverType: 'fastify'
      };
    });
  }

  // Start listening
  try {
    await fastify.listen({
      port: config.port,
      host: '0.0.0.0'
    });

    logger.info(`Fastify server listening on port ${config.port}`);
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

    const serverInstance: FastifyServerInstance = {
      close: async () => {
        try {
          await fastify.close();
          userService.destroy();
          sessionService.destroy();
        } catch (error) {
          logger.error(`Error closing Fastify server: ${error}`);
          throw error;
        }
      }
    };

    return serverInstance;
  } catch (error) {
    logger.error(`Failed to start Fastify server: ${error}`);
    throw error;
  }
};