// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Logger } from '../types';
import { generateSessionToken } from '../utils/crypto';

/**
 * Session data structure
 */
export interface Session {
  token: string;
  userId: string;
  username: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Session creation request
 */
export interface CreateSessionRequest {
  userId: string;
  username: string;
  role: string;
  expirationHours?: number; // Default: 24 hours
}

/**
 * Session service configuration
 */
export interface SessionServiceConfig {
  logger: Logger;
  cleanupIntervalMinutes?: number; // Default: 60 minutes
}

/**
 * Session service interface for managing in-memory sessions
 */
export interface SessionService {
  initialize(): void;
  destroy(): void;
  createSession(request: CreateSessionRequest): Session;
  getSession(token: string): Session | null;
  validateSession(token: string): Session | null;
  deleteSession(token: string): boolean;
  deleteAllUserSessions(userId: string): number;
  getActiveSessions(): Session[];
  getActiveSessionCount(): number;
  cleanup(): number;
}

/**
 * Creates a session service instance for managing in-memory sessions
 * @param config - Session service configuration
 * @returns Session service instance
 */
export const createSessionService = (config: SessionServiceConfig): SessionService => {
  const { logger, cleanupIntervalMinutes = 60 } = config;
  const sessions: Map<string, Session> = new Map();
  let cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Removes expired sessions from memory
   */
  const cleanupExpiredSessions = (): number => {
    const now = new Date();
    let cleanupCount = 0;

    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(token);
        cleanupCount++;
      }
    }

    if (cleanupCount > 0) {
      logger.debug(`Cleaned up ${cleanupCount} expired sessions`);
    }

    return cleanupCount;
  };

  /**
   * Starts the cleanup interval timer
   */
  const startCleanupTimer = (): void => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }

    cleanupInterval = setInterval(() => {
      cleanupExpiredSessions();
    }, cleanupIntervalMinutes * 60 * 1000);

    logger.debug(`Started session cleanup timer (interval: ${cleanupIntervalMinutes} minutes)`);
  };

  /**
   * Stops the cleanup interval timer
   */
  const stopCleanupTimer = (): void => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
      logger.debug('Stopped session cleanup timer');
    }
  };

  return {
    /**
     * Initializes the session service
     */
    initialize(): void {
      logger.info('Initializing session service');
      sessions.clear();
      startCleanupTimer();
      logger.info('Session service initialization completed');
    },

    /**
     * Destroys the session service and cleans up resources
     */
    destroy(): void {
      logger.info('Destroying session service');
      stopCleanupTimer();
      sessions.clear();
      logger.info('Session service destroyed');
    },

    /**
     * Creates a new session for a user
     * @param request - Session creation request
     * @returns Created session
     */
    createSession(request: CreateSessionRequest): Session {
      const token = generateSessionToken();
      const now = new Date();
      const expirationHours = request.expirationHours || 24;
      const expiresAt = new Date(now.getTime() + (expirationHours * 60 * 60 * 1000));

      const session: Session = {
        token,
        userId: request.userId,
        username: request.username,
        role: request.role,
        expiresAt,
        createdAt: now
      };

      sessions.set(token, session);
      
      logger.info(`Created session for user: ${request.username} (expires: ${expiresAt.toISOString()})`);
      logger.debug(`Active sessions count: ${sessions.size}`);

      return session;
    },

    /**
     * Gets a session by token (without validation)
     * @param token - Session token
     * @returns Session or null if not found
     */
    getSession(token: string): Session | null {
      return sessions.get(token) || null;
    },

    /**
     * Validates and returns a session if it exists and is not expired
     * @param token - Session token
     * @returns Valid session or null
     */
    validateSession(token: string): Session | null {
      const session = sessions.get(token);
      if (!session) {
        return null;
      }

      const now = new Date();
      if (session.expiresAt <= now) {
        sessions.delete(token);
        logger.debug(`Removed expired session for user: ${session.username}`);
        return null;
      }

      return session;
    },

    /**
     * Deletes a session
     * @param token - Session token to delete
     * @returns True if session was deleted, false if not found
     */
    deleteSession(token: string): boolean {
      const session = sessions.get(token);
      const deleted = sessions.delete(token);
      
      if (deleted && session) {
        logger.info(`Deleted session for user: ${session.username}`);
        logger.debug(`Active sessions count: ${sessions.size}`);
      }
      
      return deleted;
    },

    /**
     * Deletes all sessions for a specific user
     * @param userId - User ID
     * @returns Number of sessions deleted
     */
    deleteAllUserSessions(userId: string): number {
      let deletedCount = 0;
      
      for (const [token, session] of sessions) {
        if (session.userId === userId) {
          sessions.delete(token);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        logger.info(`Deleted ${deletedCount} sessions for user ID: ${userId}`);
        logger.debug(`Active sessions count: ${sessions.size}`);
      }

      return deletedCount;
    },

    /**
     * Gets all active (non-expired) sessions
     * @returns Array of active sessions
     */
    getActiveSessions(): Session[] {
      const now = new Date();
      const activeSessions: Session[] = [];

      for (const session of sessions.values()) {
        if (session.expiresAt > now) {
          activeSessions.push(session);
        }
      }

      return activeSessions;
    },

    /**
     * Gets the count of active sessions
     * @returns Number of active sessions
     */
    getActiveSessionCount(): number {
      return this.getActiveSessions().length;
    },

    /**
     * Manually triggers cleanup of expired sessions
     * @returns Number of sessions cleaned up
     */
    cleanup(): number {
      return cleanupExpiredSessions();
    }
  };
};