// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { delay } from "async-primitives";
import { Logger } from "../types";

/**
 * Authentication failure entry
 */
interface FailureEntry {
  count: number;
  lastAttempt: number;
  firstAttempt: number;
}

/**
 * Configuration for auth failure tracking
 */
export interface AuthFailureTrackerConfig {
  logger: Logger;
  enabled?: boolean;
  maxDelay?: number;
  resetAfterMs?: number;
  delays?: number[];
}

/**
 * Authentication failure tracker service interface
 * Tracks failed authentication attempts by IP and username
 * Implements progressive delays to prevent brute force attacks
 */
export interface AuthFailureTracker {
  readonly recordFailure: (request: any, username?: string) => void;
  readonly applyDelay: (request: any, username?: string) => Promise<number>;
  readonly clearFailures: (request: any, username?: string) => void;
  readonly getFailureCount: (request: any, username?: string) => number;
  readonly getStats: () => {
    ipCount: number;
    userCount: number;
    enabled: boolean;
  };
  readonly destroy: () => void;
}

/**
 * Creates an authentication failure tracker service
 * @param config - Auth failure tracker configuration
 * @returns Auth failure tracker service instance
 */
export const createAuthFailureTracker = (
  config: AuthFailureTrackerConfig,
): AuthFailureTracker => {
  const { logger } = config;
  const enabled = config.enabled ?? true;
  const maxDelay = config.maxDelay ?? 10000;
  const resetAfterMs = config.resetAfterMs ?? 3600000; // 1 hour
  const delays = config.delays ?? [1000, 2000, 3000, 5000, 10000]; // Progressive delays in ms

  const ipFailures = new Map<string, FailureEntry>();
  const userFailures = new Map<string, FailureEntry>();
  let cleanupTimer: NodeJS.Timeout | undefined = undefined;

  /**
   * Get client IP address from request
   */
  const getClientIp = (request: any): string => {
    // Check X-Forwarded-For header first (for proxied requests)
    const forwardedFor = request.headers["x-forwarded-for"];
    if (forwardedFor) {
      // Take the first IP in the chain
      const ips = forwardedFor.split(",").map((ip: string) => ip.trim());
      if (ips.length > 0 && ips[0]) {
        return ips[0];
      }
    }

    // Check X-Real-IP header
    const realIp = request.headers["x-real-ip"];
    if (realIp) {
      return realIp;
    }

    // Fall back to socket remote address
    return request.socket?.remoteAddress || "unknown";
  };

  /**
   * Clean up old entries
   */
  const cleanup = (): void => {
    const now = Date.now();
    const resetThreshold = now - resetAfterMs;

    // Clean up IP failures
    for (const [ip, entry] of ipFailures.entries()) {
      if (entry.lastAttempt < resetThreshold) {
        ipFailures.delete(ip);
        logger.debug(`Cleaned up auth failure tracking for IP: ${ip}`);
      }
    }

    // Clean up user failures
    for (const [username, entry] of userFailures.entries()) {
      if (entry.lastAttempt < resetThreshold) {
        userFailures.delete(username);
        logger.debug(`Cleaned up auth failure tracking for user: ${username}`);
      }
    }
  };

  /**
   * Start periodic cleanup of old entries
   */
  const startCleanupTimer = (): void => {
    if (!enabled) {
      return;
    }

    // Clean up old entries every 10 minutes
    cleanupTimer = setInterval(() => {
      cleanup();
    }, 600000); // 10 minutes
  };

  /**
   * Stop the cleanup timer
   */
  const stopCleanupTimer = (): void => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = undefined;
    }
  };

  // Start cleanup timer if enabled
  if (enabled) {
    startCleanupTimer();
  }

  return {
    /**
     * Record a failed authentication attempt
     */
    recordFailure: (request: any, username?: string): void => {
      if (!enabled) {
        return;
      }

      const now = Date.now();
      const ip = getClientIp(request);

      // Track by IP
      if (ip && ip !== "unknown") {
        const ipEntry = ipFailures.get(ip) || {
          count: 0,
          firstAttempt: now,
          lastAttempt: now,
        };

        // Reset if too old
        if (now - ipEntry.lastAttempt > resetAfterMs) {
          ipEntry.count = 0;
          ipEntry.firstAttempt = now;
        }

        ipEntry.count++;
        ipEntry.lastAttempt = now;
        ipFailures.set(ip, ipEntry);

        logger.warn(
          `Auth failure recorded for IP ${ip}: attempt #${ipEntry.count}`,
        );
      }

      // Track by username (if provided)
      if (username) {
        const userEntry = userFailures.get(username) || {
          count: 0,
          firstAttempt: now,
          lastAttempt: now,
        };

        // Reset if too old
        if (now - userEntry.lastAttempt > resetAfterMs) {
          userEntry.count = 0;
          userEntry.firstAttempt = now;
        }

        userEntry.count++;
        userEntry.lastAttempt = now;
        userFailures.set(username, userEntry);

        logger.warn(
          `Auth failure recorded for user ${username}: attempt #${userEntry.count}`,
        );
      }
    },

    /**
     * Apply delay based on failure count
     * Returns the delay in milliseconds that was applied
     */
    applyDelay: async (request: any, username?: string): Promise<number> => {
      if (!enabled) {
        return 0;
      }

      const ip = getClientIp(request);
      let failureCount = 0;

      // Get max failure count from IP or username
      if (ip && ip !== "unknown") {
        const ipEntry = ipFailures.get(ip);
        if (ipEntry) {
          failureCount = Math.max(failureCount, ipEntry.count);
        }
      }

      if (username) {
        const userEntry = userFailures.get(username);
        if (userEntry) {
          failureCount = Math.max(failureCount, userEntry.count);
        }
      }

      if (failureCount === 0) {
        return 0;
      }

      // Calculate delay based on failure count
      const delayIndex = Math.min(failureCount - 1, delays.length - 1);
      const delayMs = Math.min(delays[delayIndex] ?? 0, maxDelay);

      if (delayMs > 0) {
        logger.info(
          `Applying ${delayMs}ms delay for auth failure #${failureCount} (IP: ${ip}, user: ${username || "N/A"})`,
        );
        await delay(delayMs);
      }

      return delayMs;
    },

    /**
     * Clear failure records for successful authentication
     */
    clearFailures: (request: any, username?: string): void => {
      if (!enabled) {
        return;
      }

      const ip = getClientIp(request);

      // Clear IP failures
      if (ip && ip !== "unknown" && ipFailures.has(ip)) {
        ipFailures.delete(ip);
        logger.debug(`Cleared auth failure tracking for IP: ${ip}`);
      }

      // Clear user failures
      if (username && userFailures.has(username)) {
        userFailures.delete(username);
        logger.debug(`Cleared auth failure tracking for user: ${username}`);
      }
    },

    /**
     * Get current failure count for diagnostics
     */
    getFailureCount: (request: any, username?: string): number => {
      if (!enabled) {
        return 0;
      }

      const ip = getClientIp(request);
      let failureCount = 0;

      if (ip && ip !== "unknown") {
        const ipEntry = ipFailures.get(ip);
        if (ipEntry) {
          failureCount = Math.max(failureCount, ipEntry.count);
        }
      }

      if (username) {
        const userEntry = userFailures.get(username);
        if (userEntry) {
          failureCount = Math.max(failureCount, userEntry.count);
        }
      }

      return failureCount;
    },

    /**
     * Get statistics for monitoring
     */
    getStats: (): { ipCount: number; userCount: number; enabled: boolean } => {
      return {
        ipCount: ipFailures.size,
        userCount: userFailures.size,
        enabled: enabled,
      };
    },

    /**
     * Stop the cleanup timer and clean up resources
     */
    destroy: (): void => {
      stopCleanupTimer();
      ipFailures.clear();
      userFailures.clear();
      logger.debug("Auth failure tracker destroyed");
    },
  };
};

/**
 * Create auth failure tracker from environment variables
 */
export const createAuthFailureTrackerFromEnv = (
  logger: Logger,
): AuthFailureTracker => {
  const enabled =
    process.env.NUGET_SERVER_AUTH_FAILURE_DELAY_ENABLED !== "false";
  const maxDelay = process.env.NUGET_SERVER_AUTH_FAILURE_MAX_DELAY
    ? parseInt(process.env.NUGET_SERVER_AUTH_FAILURE_MAX_DELAY, 10)
    : undefined;

  return createAuthFailureTracker({
    logger,
    enabled,
    maxDelay,
  });
};
