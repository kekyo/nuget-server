// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { FastifyRequest, FastifyReply } from "fastify";
import { Strategy as LocalStrategy } from "passport-local";
import { BasicStrategy } from "passport-http";
import { Logger } from "../types";
import { UserService } from "../services/userService";
import { SessionService } from "../services/sessionService";
import { AuthFailureTracker } from "../services/authFailureTracker";

/**
 * Fastify authentication middleware configuration
 */
export interface FastifyAuthConfig {
  realm?: string;
  userService: UserService;
  sessionService: SessionService;
  authFailureTracker?: AuthFailureTracker;
  logger: Logger;
}

/**
 * Extended Fastify request interface with user information
 */
export interface AuthenticatedFastifyRequest extends FastifyRequest {
  user?: {
    username: string;
    role: string;
  };
}

/**
 * Checks if the request is from a UI (browser) based on Accept header
 * @param request - Fastify request
 * @returns True if request appears to be from UI
 */
const isUIRequest = (request: FastifyRequest): boolean => {
  const acceptHeader = request.headers.accept || "";
  // Only consider requests specifically asking for HTML as UI requests
  // Don't treat generic */*, application/json or other API content types as UI requests
  return (
    acceptHeader.includes("text/html") &&
    !acceptHeader.includes("application/json")
  );
};

/**
 * Parses Basic authentication header
 * @param authHeader - Authorization header value
 * @returns Parsed credentials or null
 */
const parseBasicAuth = (
  authHeader: string,
): { username: string; password: string } | null => {
  try {
    if (!authHeader.startsWith("Basic ")) {
      return null;
    }

    const credentials = authHeader.substring(6); // Remove 'Basic ' prefix
    const decodedCredentials = Buffer.from(credentials, "base64").toString(
      "utf-8",
    );
    const colonIndex = decodedCredentials.indexOf(":");

    if (colonIndex === -1) {
      return null;
    }

    const username = decodedCredentials.substring(0, colonIndex);
    const password = decodedCredentials.substring(colonIndex + 1);

    // Allow empty credentials (dotnet CLI probing behavior)
    // Empty username and password is valid but will fail authentication
    return { username, password };
  } catch (error) {
    return null;
  }
};

/**
 * Sends 401 Unauthorized response with WWW-Authenticate header
 * @param reply - Fastify reply object
 * @param realm - Authentication realm
 */
const sendUnauthorized = (reply: FastifyReply, realm: string) => {
  reply.header("WWW-Authenticate", `Basic realm="${realm}"`);
  reply.status(401).send({
    error: "Authentication required",
    message: "Please provide valid credentials",
  });
};

/**
 * Creates Passport.js Local Strategy for UI authentication
 * @param config - Authentication configuration
 * @returns Local strategy instance
 */
export const createLocalStrategy = (
  config: FastifyAuthConfig,
): LocalStrategy => {
  const { userService, logger } = config;

  return new LocalStrategy(
    {
      usernameField: "username",
      passwordField: "password",
    },
    async (username: string, password: string, done) => {
      try {
        logger.debug(`Local strategy authenticating user: ${username}`);

        const user = await userService.validateCredentials(username, password);
        if (!user) {
          logger.warn(`Local authentication failed for user: ${username}`);
          return done(null, false, { message: "Invalid credentials" });
        }

        logger.debug(`Local authentication successful for user: ${username}`);
        return done(null, {
          id: user.id,
          username: user.username,
          role: user.role,
        });
      } catch (error) {
        logger.error(`Local strategy error: ${error}`);
        return done(error);
      }
    },
  );
};

/**
 * Creates Passport.js Basic Strategy for API authentication
 * @param config - Authentication configuration
 * @returns Basic strategy instance
 */
export const createBasicStrategy = (
  config: FastifyAuthConfig,
): BasicStrategy => {
  const { userService, logger } = config;

  return new BasicStrategy(async (username: string, password: string, done) => {
    try {
      logger.debug(`Basic strategy authenticating user: ${username}`);

      const user = await userService.validateApiPassword(username, password);
      if (!user) {
        logger.warn(`Basic authentication failed for user: ${username}`);
        return done(null, false);
      }

      logger.debug(`Basic authentication successful for user: ${username}`);
      return done(null, {
        id: user.id,
        username: user.username,
        role: user.role,
      });
    } catch (error) {
      logger.error(`Basic strategy error: ${error}`);
      return done(error);
    }
  });
};

/**
 * Creates hybrid authentication middleware that supports both session and Basic auth
 * @param config - Authentication configuration
 * @returns Fastify hook function
 */
export const createHybridAuthMiddleware = (config: FastifyAuthConfig) => {
  const realm = config.realm || "NuGet Server";
  const { userService, sessionService, authFailureTracker, logger } = config;

  return async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    logger.debug(`Hybrid auth check for ${request.method} ${request.url}`);

    try {
      // 1. Check session authentication (Cookie-based, for UI)
      const sessionToken = request.cookies?.sessionToken;
      if (sessionToken) {
        logger.debug("Checking session authentication");
        const session = sessionService.validateSession(sessionToken);
        if (session) {
          logger.debug(`Session auth successful for user: ${session.username}`);
          request.user = {
            username: session.username,
            role: session.role,
          };
          return;
        } else {
          logger.debug("Invalid or expired session token");
          // Clear invalid session cookie
          reply.clearCookie("sessionToken", {
            httpOnly: true,
            secure: request.protocol === "https",
            sameSite: "strict" as const,
            path: "/",
          });
        }
      }

      // 2. Check Basic authentication (for API clients)
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith("Basic ")) {
        logger.debug("Checking Basic authentication");
        const credentials = parseBasicAuth(authHeader);

        if (credentials) {
          // Check for empty credentials (common with dotnet CLI probing)
          if (!credentials.username && !credentials.password) {
            logger.info(
              "Empty Basic auth credentials received - returning 401 Unauthorized",
            );
          } else {
            const user = await userService.validateApiPassword(
              credentials.username,
              credentials.password,
            );
            if (user) {
              logger.debug(`Basic auth successful for user: ${user.username}`);

              // Clear failures on successful authentication
              if (authFailureTracker) {
                authFailureTracker.clearFailures(request, credentials.username);
              }

              request.user = {
                username: user.username,
                role: user.role,
              };
              return;
            } else {
              logger.info(
                `Basic auth failed for user: ${credentials.username} - returning 401 Unauthorized`,
              );

              // Record failure and apply delay before responding
              if (authFailureTracker) {
                authFailureTracker.recordFailure(request, credentials.username);
                await authFailureTracker.applyDelay(
                  request,
                  credentials.username,
                );
              }
            }
          }
        } else {
          logger.info(
            "Invalid Basic auth header format - returning 401 Unauthorized",
          );

          // Record failure for invalid Basic auth format
          if (authFailureTracker) {
            authFailureTracker.recordFailure(request);
            await authFailureTracker.applyDelay(request);
          }
        }
      }

      // 3. Authentication failed
      logger.debug(
        `Authentication failed for ${request.method} ${request.url}`,
      );

      if (isUIRequest(request)) {
        // For UI requests, redirect to login page
        logger.debug("Redirecting UI request to login");
        return reply.redirect("/login");
      } else {
        // For API requests, send 401 with WWW-Authenticate header
        logger.debug("Sending 401 for API request");
        return sendUnauthorized(reply, realm);
      }
    } catch (error) {
      logger.error(`Hybrid auth error: ${error}`);
      return reply.status(500).send({
        error: "Authentication error",
        message: "Internal server error during authentication",
      });
    }
  };
};

/**
 * Creates a conditional hybrid authentication middleware
 * @param config - Authentication configuration
 * @param skipAuth - If true, skip authentication regardless of configuration
 * @returns Fastify hook function that conditionally applies authentication
 */
export const createConditionalHybridAuthMiddleware = (
  config: FastifyAuthConfig,
  skipAuth: boolean = false,
) => {
  // If authentication should be skipped, return a no-op middleware
  if (skipAuth) {
    return async (
      request: AuthenticatedFastifyRequest,
      reply: FastifyReply,
    ) => {
      config.logger.debug(
        `Hybrid auth skipped for ${request.method} ${request.url} - disabled by configuration`,
      );
    };
  }

  // Use hybrid auth when not skipped
  return createHybridAuthMiddleware(config);
};

/**
 * Creates Session-only authentication middleware (for UI APIs)
 * @param config - Authentication configuration
 * @returns Fastify hook function
 */
export const createSessionOnlyAuthMiddleware = (config: FastifyAuthConfig) => {
  const { sessionService, logger } = config;

  return async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    logger.debug(
      `Session-only auth check for ${request.method} ${request.url}`,
    );

    try {
      // Check session authentication only
      const sessionToken = request.cookies?.sessionToken;
      if (!sessionToken) {
        logger.debug("No session token found");
        return reply.status(401).send({
          error: "Session authentication required",
          message: "Please log in to access this resource",
        });
      }

      const session = sessionService.validateSession(sessionToken);
      if (!session) {
        logger.debug("Invalid or expired session token");
        // Clear invalid session cookie
        reply.clearCookie("sessionToken", {
          httpOnly: true,
          secure: request.protocol === "https",
          sameSite: "strict" as const,
          path: "/",
        });

        return reply.status(401).send({
          error: "Invalid or expired session",
          message: "Please log in again",
        });
      }

      logger.debug(`Session auth successful for user: ${session.username}`);
      request.user = {
        username: session.username,
        role: session.role,
      };
    } catch (error) {
      logger.error(`Session auth error: ${error}`);
      return reply.status(500).send({
        error: "Authentication error",
        message: "Internal server error during authentication",
      });
    }
  };
};

/**
 * Creates a role-based authorization middleware
 * @param requiredRoles - Array of required roles (user must have at least one)
 * @param logger - Logger instance
 * @returns Fastify hook function
 */
export const createRoleAuthorizationMiddleware = (
  requiredRoles: string[],
  logger: Logger,
) => {
  return async (request: AuthenticatedFastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      logger.warn(`Authorization failed - no user information in request`);
      return reply.status(401).send({
        error: "Authentication required",
        message: "User must be authenticated",
      });
    }

    const userRole = request.user.role;
    const hasRequiredRole =
      requiredRoles.includes(userRole) ||
      (requiredRoles.includes("read") &&
        ["publish", "admin"].includes(userRole)) ||
      (requiredRoles.includes("publish") && userRole === "admin");

    if (!hasRequiredRole) {
      logger.warn(
        `Authorization failed for user: ${request.user.username} (role: ${userRole}, required: ${requiredRoles.join(", ")})`,
      );
      return reply.status(403).send({
        error: "Insufficient permissions",
        message: `Required role: ${requiredRoles.join(" or ")}`,
      });
    }

    logger.debug(
      `Authorization successful for user: ${request.user.username} (role: ${userRole})`,
    );
  };
};

/**
 * Helper function to check if user has required role
 * @param request - Authenticated Fastify request
 * @param roles - Required roles
 * @returns True if user has required role
 */
export const requireRole = (
  request: AuthenticatedFastifyRequest,
  roles: string[],
): boolean => {
  if (!request.user) {
    return false;
  }

  const userRole = request.user.role;
  return (
    roles.includes(userRole) ||
    (roles.includes("read") && ["publish", "admin"].includes(userRole)) ||
    (roles.includes("publish") && userRole === "admin")
  );
};
