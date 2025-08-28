// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import Fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
  FastifyTypeProviderDefault,
  RawServerDefault,
  RouteGenericInterface,
} from "fastify";
import fastifyPassport from "@fastify/passport";
import fastifySecureSession from "@fastify/secure-session";
import fastifyStatic from "@fastify/static";
import { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import {
  name as packageName,
  version,
  git_commit_hash,
} from "./generated/packageMetadata";
import { streamFile } from "./utils/fileStreaming";
import { createMetadataService } from "./services/metadataService";
import { createAuthService } from "./services/authService";
import { createUserService } from "./services/userService";
import { createSessionService } from "./services/sessionService";
import { createAuthFailureTrackerFromEnv } from "./services/authFailureTracker";
import { Logger, ServerConfig } from "./types";
import { createUrlResolver } from "./utils/urlResolver";
import { createFastifyLoggerAdapter } from "./utils/fastifyLoggerAdapter";
import {
  createLocalStrategy,
  createBasicStrategy,
  FastifyAuthConfig,
} from "./middleware/fastifyAuth";
import { registerV3Routes } from "./routes/v3/index";
import { registerUiRoutes } from "./routes/api/ui/index";
import {
  registerPublishRoutes,
  type PublishRoutesConfig,
} from "./routes/api/publish/index";
import { createReaderWriterLock, ReaderWriterLock } from "async-primitives";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type GetReply = FastifyReply<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  RouteGenericInterface,
  unknown,
  FastifySchema,
  FastifyTypeProviderDefault,
  unknown
>;

/**
 * Server instance with cleanup functionality
 */
export interface FastifyServerInstance {
  close: () => Promise<void>;
}

/**
 * Creates and configures a Fastify instance without starting the server
 * @param config - Server configuration including port, baseUrl, and trusted proxies
 * @param logger - Logger instance for logging server events
 * @param locker - WriterLock for safe shutdown
 * @returns Promise that resolves to configured Fastify instance
 * @remarks When shutting down Fastify using close(), conflicts may occur with stream completion if file transfers are in progress via the stream. To safely avoid this, it uses a ReaderWriterLock. When shutting down Fastify, you must first acquire the WriterLock. This enables exclusive handling with stream transfers, preventing the above issue.
 */
export const createFastifyInstance = async (
  config: ServerConfig,
  logger: Logger,
  locker: ReaderWriterLock,
): Promise<FastifyInstance> => {
  // Create Fastify logger adapter to integrate with project Logger
  const fastifyLoggerAdapter = createFastifyLoggerAdapter(
    logger,
    config.logLevel || "info",
  );

  // Create Fastify instance with integrated logging
  const fastify: FastifyInstance = Fastify({
    logger: fastifyLoggerAdapter,
    bodyLimit: 1024 * 1024 * 100, // 100MB limit for package uploads
    disableRequestLogging: true, // Use our custom request logging
  });

  // Add content type parser for binary data (package uploads)
  fastify.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // Initialize URL resolver
  const urlResolver = createUrlResolver({
    baseUrl: config.baseUrl,
    trustedProxies: config.trustedProxies,
  });

  // Initialize metadata service
  const packagesRoot = config.packageDir || process.cwd() + "/packages";
  const initialBaseUrl = config.baseUrl || `http://localhost:${config.port}`;
  const isHttps = initialBaseUrl.startsWith("https://");
  const metadataService = createMetadataService(
    packagesRoot,
    initialBaseUrl,
    logger,
  );

  try {
    await metadataService.initialize();
  } catch (error) {
    logger.error(`Failed to initialize metadata service: ${error}`);
    throw error;
  }

  // Initialize authentication service (for auth mode checking)
  const authService = createAuthService({
    authMode: config.authMode || "none",
    logger,
  });

  // Initialize user service (new authentication system)
  const userService = createUserService({
    configDir: config.configDir || "./",
    logger,
    serverConfig: config,
  });

  try {
    await userService.initialize();
  } catch (error) {
    logger.error(`Failed to initialize user service: ${error}`);
    throw error;
  }

  // Initialize session service
  const sessionService = createSessionService({
    logger,
  });

  try {
    sessionService.initialize();
  } catch (error) {
    logger.error(`Failed to initialize session service: ${error}`);
    throw error;
  }

  // Initialize auth failure tracker
  const authFailureTracker = createAuthFailureTrackerFromEnv(logger);

  // Generate or use provided session secret
  let sessionKey: Buffer;
  if (config.sessionSecret) {
    // Use provided secret (ensure it's 32 bytes)
    const secret = config.sessionSecret.padEnd(32, "0").substring(0, 32);
    sessionKey = Buffer.from(secret);
  } else {
    // Generate random secret and log info
    const crypto = await import("crypto");
    sessionKey = crypto.randomBytes(32);
    logger.info(
      "Session secret was not provided. Generated a random session secret for this instance.",
    );
    logger.info(
      "To persist sessions across restarts, set NUGET_SERVER_SESSION_SECRET environment variable.",
    );
  }

  // Configure secure session plugin with session decorator
  await fastify.register(fastifySecureSession, {
    key: sessionKey,
    cookie: {
      path: "/",
      httpOnly: true,
      secure: isHttps, // Automatically determined from baseUrl
      sameSite: "strict" as const,
      maxAge: 86400000, // 24 hours
    },
  });

  // Configure Passport plugin (depends on session)
  await fastify.register(fastifyPassport.initialize());
  await fastify.register(fastifyPassport.secureSession());

  // Register static file plugin (provides sendFile method)
  await fastify.register(fastifyStatic, {
    root: "/", // This allows sending files from absolute paths
    serve: false, // Disable automatic serving, use sendFile manually
  });

  // Add AbortSignal to every request for handling client disconnections
  fastify.decorateRequest("abortSignal", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const controller = new AbortController();

    // Listen for client disconnect
    request.raw.once("close", () => {
      // Check if connection was aborted (deprecated but still the most reliable method)
      // @ts-ignore - aborted is deprecated but still works
      if (request.raw.aborted) {
        controller.abort();
        logger.debug(`Request aborted: ${request.url}`);
      }
    });

    request.abortSignal = controller.signal;
  });

  // Create authentication configuration
  const authConfig: FastifyAuthConfig = {
    realm: config.realm || `${packageName} ${version}`,
    userService,
    sessionService,
    authFailureTracker,
    logger,
  };

  // Configure Passport strategies
  const localStrategy = createLocalStrategy(authConfig);
  const basicStrategy = createBasicStrategy(authConfig);

  fastifyPassport.use("local", localStrategy);
  fastifyPassport.use("basic", basicStrategy);

  // Passport serialization for sessions
  fastifyPassport.registerUserSerializer(async (user: any) => user.id);
  fastifyPassport.registerUserDeserializer(async (id: string) => {
    // Get user from user service by ID
    const allUsers = await userService.getAllUsers();
    return allUsers.find((user) => user.id === id) || null;
  });

  // Basic health check endpoint
  fastify.get("/health", async (_request, _reply) => {
    return { status: "ok", version };
  });

  // Generate server URL info for UI
  const serverUrl = {
    baseUrl: config.baseUrl,
    port: config.port,
    isHttps: config.baseUrl ? config.baseUrl.startsWith("https:") : false,
  };

  if (!config.noUi) {
    // Authentication endpoints (must be accessible without authentication for login)
    fastify.post("/api/auth/login", async (request, reply) => {
      const { username, password, rememberMe } = request.body as any;

      try {
        const user = await userService.validateCredentials(username, password);
        if (!user) {
          // Record failure and apply delay before responding
          authFailureTracker.recordFailure(request, username);
          await authFailureTracker.applyDelay(request, username);

          return reply.status(401).send({
            success: false,
            message: "Invalid credentials",
          });
        }

        // Clear failures on successful authentication
        authFailureTracker.clearFailures(request, username);

        // Create session
        const expirationHours = rememberMe ? 7 * 24 : 24; // 7 days or 24 hours
        const session = sessionService.createSession({
          userId: user.id,
          username: user.username,
          role: user.role,
          expirationHours: expirationHours,
        });

        // Set session cookie
        reply.setCookie("sessionToken", session.token, {
          httpOnly: true,
          secure: request.protocol === "https",
          sameSite: "strict" as const,
          maxAge: expirationHours * 60 * 60 * 1000,
          path: "/",
        });

        return {
          success: true,
          user: {
            username: user.username,
            role: user.role,
          },
        };
      } catch (error) {
        logger.error(`Login error: ${error}`);
        return reply.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });

    fastify.post("/api/auth/logout", async (request, reply) => {
      const sessionToken = request.cookies?.sessionToken;

      if (sessionToken) {
        sessionService.deleteSession(sessionToken);
      }

      reply.clearCookie("sessionToken", {
        httpOnly: true,
        secure: request.protocol === "https",
        sameSite: "strict" as const,
        path: "/",
      });

      return {
        success: true,
        message: "Logged out successfully",
      };
    });

    fastify.get("/api/auth/session", async (request, reply) => {
      const sessionToken = request.cookies?.sessionToken;

      if (!sessionToken) {
        return {
          authenticated: false,
          user: null,
        };
      }

      const session = sessionService.validateSession(sessionToken);
      if (!session) {
        // Clear invalid session cookie
        reply.clearCookie("sessionToken", {
          httpOnly: true,
          secure: request.protocol === "https",
          sameSite: "strict" as const,
          path: "/",
        });

        return {
          authenticated: false,
          user: null,
        };
      }

      return {
        authenticated: true,
        user: {
          username: session.username,
          role: session.role,
        },
      };
    });

    // Serve config endpoint without authentication (public endpoint per CLAUDE.md spec)
    fastify.get("/api/config", async (request: FastifyRequest, _reply) => {
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
              authenticated: true,
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
        serverUrl: serverUrl,
        authMode: authService.getAuthMode(),
        authEnabled: {
          general: authService.isAuthRequired("general"),
          publish: authService.isAuthRequired("publish"),
          admin: authService.isAuthRequired("admin"),
        },
        currentUser: currentUser,
      };
    });

    // Register V3 API routes
    try {
      await registerV3Routes(
        fastify,
        {
          metadataService,
          authService,
          authConfig,
          packagesRoot,
          logger,
          urlResolver,
        },
        locker,
      );
    } catch (error) {
      logger.error(`Failed to register V3 routes: ${error}`);
      throw error;
    }

    // Register UI Backend API routes
    try {
      await fastify.register(
        async (fastify) => {
          await registerUiRoutes(
            fastify,
            {
              userService,
              sessionService,
              authService,
              packagesRoot,
              logger,
              realm: config.realm || `${packageName} ${version}`,
              serverUrl,
              metadataService,
            },
            locker,
          );
        },
        { prefix: "/api/ui" },
      );
    } catch (error) {
      logger.error(`Failed to register UI routes: ${error}`);
      throw error;
    }

    // Register Publish API routes
    try {
      let publishServiceSetter: any;
      await fastify.register(
        async (fastify) => {
          const config: PublishRoutesConfig = {
            packagesRoot,
            authService,
            authConfig,
            logger,
            urlResolver,
          };
          const publishRoutes = await registerPublishRoutes(fastify, config);
          publishServiceSetter = publishRoutes.setPackageUploadService;
        },
        { prefix: "/api" },
      );

      // Set package upload service for publish functionality
      if (publishServiceSetter) {
        publishServiceSetter(metadataService);
      }
    } catch (error) {
      logger.error(`Failed to register Publish routes: ${error}`);
      throw error;
    }

    // Serve UI files with custom handler
    // Check if we're in development mode
    const devUiPath = path.join(process.cwd(), "src", "ui");
    const devPublicPath = path.join(process.cwd(), "src", "ui", "public");
    const prodUiPath = path.join(__dirname, "ui");

    const isDevMode = existsSync(devPublicPath);
    const uiPath = isDevMode ? devUiPath : prodUiPath;
    const publicPath = isDevMode ? devPublicPath : prodUiPath;
    const imagesPath = path.join(__dirname, "..", "images");

    // Helper function to serve static files using streaming
    const serveStaticFile = (
      filePath: string,
      reply: GetReply,
      signal?: AbortSignal,
    ) => {
      // Use the unified file streaming helper
      return streamFile(logger, locker, filePath, reply, {}, signal);
    };

    // Serve UI at root path
    fastify.get("/", (request, reply: GetReply) => {
      const indexPath = path.join(uiPath, "index.html");
      return serveStaticFile(indexPath, reply, request.abortSignal);
    });

    // Serve login page
    fastify.get("/login", (request, reply: GetReply) => {
      const loginPath = path.join(uiPath, "login.html");
      return serveStaticFile(loginPath, reply, request.abortSignal);
    });

    // Serve other UI assets
    fastify.get("/assets/*", (request, reply: GetReply) => {
      const assetPath = (request.params as any)["*"];
      const fullPath = path.join(uiPath, "assets", assetPath);
      return serveStaticFile(fullPath, reply, request.abortSignal);
    });

    // Serve images
    fastify.get("/images/*", (request, reply: GetReply) => {
      const imagePath = (request.params as any)["*"];
      const fullPath = path.join(imagesPath, imagePath);
      return serveStaticFile(fullPath, reply, request.abortSignal);
    });

    // Serve favicon
    fastify.get("/favicon.ico", (request, reply: GetReply) => {
      const faviconPath = path.join(publicPath, "favicon.ico");
      return serveStaticFile(faviconPath, reply, request.abortSignal);
    });

    // Serve icon
    fastify.get("/icon.png", (request, reply: GetReply) => {
      const iconPath = path.join(publicPath, "icon.png");
      return serveStaticFile(iconPath, reply, request.abortSignal);
    });
  } else {
    // When UI is disabled, return JSON at root path
    fastify.get("/", async (_request, _reply: GetReply) => {
      return {
        message: config.realm || `${packageName} ${version}`,
        apiEndpoint: "/api",
      };
    });
  }

  // Store services on fastify instance for cleanup
  fastify.decorate("userService", userService);
  fastify.decorate("sessionService", sessionService);
  fastify.decorate("authService", authService);
  fastify.decorate("serverConfig", config);
  fastify.decorate("serverUrl", serverUrl);

  return fastify;
};

/**
 * Starts the NuGet server with Fastify framework
 * @param config - Server configuration including port, baseUrl, and trusted proxies
 * @param logger - Logger instance for logging server events
 * @returns Promise that resolves to server instance when server is started
 */
export const startFastifyServer = async (
  config: ServerConfig,
  logger: Logger,
): Promise<FastifyServerInstance> => {
  const locker = createReaderWriterLock();
  const fastify = await createFastifyInstance(config, logger, locker);

  // Get decorated services
  const userService = (fastify as any).userService;
  const sessionService = (fastify as any).sessionService;
  const authService = (fastify as any).authService;
  const serverUrlInfo = (fastify as any).serverUrl;

  // Start listening
  try {
    await fastify.listen({
      port: config.port,
      host: "0.0.0.0",
    });

    logger.info(`Fastify server listening on port ${config.port}`);
    // Build example command for logging
    const exampleCommand = serverUrlInfo.baseUrl
      ? `dotnet nuget add source "${serverUrlInfo.baseUrl}/v3/index.json" -n "ref1"${!serverUrlInfo.isHttps ? " --allow-insecure-connections" : ""}`
      : `dotnet nuget add source "http://localhost:${serverUrlInfo.port}/v3/index.json" -n "ref1" --allow-insecure-connections`;
    logger.info(`Example register command: ${exampleCommand}`);
    logger.info(`Authentication mode: ${authService.getAuthMode()}`);

    const userCount = await userService.getUserCount();

    if (authService.isAuthRequired("publish")) {
      logger.info(`Publish authentication: enabled (${userCount} users)`);
    } else {
      logger.info("Publish authentication: disabled");
    }

    if (authService.isAuthRequired("general")) {
      logger.info(`General authentication: enabled (${userCount} users)`);
    } else {
      logger.info("General authentication: disabled");
    }

    if (authService.isAuthRequired("admin")) {
      logger.info(`Admin authentication: enabled (${userCount} users)`);
    } else {
      logger.info("Admin authentication: disabled");
    }

    const serverInstance: FastifyServerInstance = {
      close: async () => {
        try {
          logger.debug("Starting server close process...");

          logger.debug("Closing Fastify instance...");

          // Acquire writer lock, makes safer shutdown race condition between file streaming.
          const handle = await locker.writeLock();
          try {
            await fastify.close();
          } finally {
            handle.release();
          }

          logger.debug("Fastify instance closed successfully");
        } catch (error) {
          logger.error(`Error closing Fastify server: ${error}`);
        } finally {
          try {
            logger.debug("Destroying user service...");
            userService.destroy();
            logger.debug("User service destroyed");
          } finally {
            try {
              logger.debug("Destroying session service...");
              sessionService.destroy();
              logger.debug("Session service destroyed");
            } finally {
              logger.debug("Server close process completed");
            }
          }
        }
      },
    };
    return serverInstance;
  } catch (error) {
    logger.error(`Failed to start Fastify server: ${error}`);
    throw error;
  }
};
