// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { createReaderWriterLock } from 'async-primitives';
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
  readonly initialize: () => Promise<void>;
  readonly destroy: () => Promise<void>;
  readonly createSession: (request: CreateSessionRequest) => Promise<Session>;
  readonly getSession: (token: string) => Promise<Session | undefined>;
  readonly validateSession: (token: string) => Promise<Session | undefined>;
  readonly deleteSession: (token: string) => Promise<boolean>;
  readonly deleteAllUserSessions: (userId: string) => Promise<number>;
  readonly getActiveSessions: () => Promise<Session[]>;
  readonly getActiveSessionCount: () => Promise<number>;
  readonly cleanup: () => Promise<number>;
}

/**
 * Creates a session service instance for managing in-memory sessions
 * @param config - Session service configuration
 * @returns Session service instance
 */
export const createSessionService = (
  config: SessionServiceConfig
): SessionService => {
  const { logger, cleanupIntervalMinutes = 60 } = config;
  const sessions: Map<string, Session> = new Map();
  let cleanupInterval: NodeJS.Timeout | undefined = undefined;
  const sessionLock = createReaderWriterLock();

  /**
   * Removes expired sessions from memory
   */
  const cleanupExpiredSessions = async (): Promise<number> => {
    const handle = await sessionLock.writeLock();
    try {
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
    } finally {
      handle.release();
    }
  };

  /**
   * Starts the cleanup interval timer
   */
  const startCleanupTimer = (): void => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }

    cleanupInterval = setInterval(
      async () => {
        await cleanupExpiredSessions();
      },
      cleanupIntervalMinutes * 60 * 1000
    );

    logger.debug(
      `Started session cleanup timer (interval: ${cleanupIntervalMinutes} minutes)`
    );
  };

  /**
   * Stops the cleanup interval timer
   */
  const stopCleanupTimer = (): void => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = undefined;
      logger.debug('Stopped session cleanup timer');
    }
  };

  /**
   * Gets all active (non-expired) sessions
   * @returns Array of active sessions
   */
  const getActiveSessions = async (): Promise<Session[]> => {
    const handle = await sessionLock.readLock();
    try {
      const now = new Date();
      const activeSessions: Session[] = [];

      for (const session of sessions.values()) {
        if (session.expiresAt > now) {
          activeSessions.push(session);
        }
      }

      return activeSessions;
    } finally {
      handle.release();
    }
  };

  return {
    /**
     * Initializes the session service
     */
    initialize: async (): Promise<void> => {
      const handle = await sessionLock.writeLock();
      try {
        logger.info('Initializing session service');
        sessions.clear();
        startCleanupTimer();
        logger.info('Session service initialization completed');
      } finally {
        handle.release();
      }
    },

    /**
     * Destroys the session service and cleans up resources
     */
    destroy: async (): Promise<void> => {
      const handle = await sessionLock.writeLock();
      try {
        logger.info('Destroying session service');
        stopCleanupTimer();
        sessions.clear();
        logger.info('Session service destroyed');
      } finally {
        handle.release();
      }
    },

    /**
     * Creates a new session for a user
     * @param request - Session creation request
     * @returns Created session
     */
    createSession: async (request: CreateSessionRequest): Promise<Session> => {
      const handle = await sessionLock.writeLock();
      try {
        const token = generateSessionToken();
        const now = new Date();
        const expirationHours = request.expirationHours || 24;
        const expiresAt = new Date(
          now.getTime() + expirationHours * 60 * 60 * 1000
        );

        const session: Session = {
          token,
          userId: request.userId,
          username: request.username,
          role: request.role,
          expiresAt,
          createdAt: now,
        };

        sessions.set(token, session);

        logger.info(
          `Created session for user: ${request.username} (expires: ${expiresAt.toISOString()})`
        );
        logger.debug(`Active sessions count: ${sessions.size}`);

        return session;
      } finally {
        handle.release();
      }
    },

    /**
     * Gets a session by token (without validation)
     * @param token - Session token
     * @returns Session or undefined if not found
     */
    getSession: async (token: string): Promise<Session | undefined> => {
      const handle = await sessionLock.readLock();
      try {
        return sessions.get(token);
      } finally {
        handle.release();
      }
    },

    /**
     * Validates and returns a session if it exists and is not expired
     * @param token - Session token
     * @returns Valid session or undefined
     */
    validateSession: async (token: string): Promise<Session | undefined> => {
      const handle = await sessionLock.writeLock(); // Write lock because we might delete
      try {
        const session = sessions.get(token);
        if (!session) {
          return undefined;
        }

        const now = new Date();
        if (session.expiresAt <= now) {
          sessions.delete(token);
          logger.debug(`Removed expired session for user: ${session.username}`);
          return undefined;
        }

        return session;
      } finally {
        handle.release();
      }
    },

    /**
     * Deletes a session
     * @param token - Session token to delete
     * @returns True if session was deleted, false if not found
     */
    deleteSession: async (token: string): Promise<boolean> => {
      const handle = await sessionLock.writeLock();
      try {
        const session = sessions.get(token);
        const deleted = sessions.delete(token);

        if (deleted && session) {
          logger.info(`Deleted session for user: ${session.username}`);
          logger.debug(`Active sessions count: ${sessions.size}`);
        }

        return deleted;
      } finally {
        handle.release();
      }
    },

    /**
     * Deletes all sessions for a specific user
     * @param userId - User ID
     * @returns Number of sessions deleted
     */
    deleteAllUserSessions: async (userId: string): Promise<number> => {
      const handle = await sessionLock.writeLock();
      try {
        let deletedCount = 0;

        for (const [token, session] of sessions) {
          if (session.userId === userId) {
            sessions.delete(token);
            deletedCount++;
          }
        }

        if (deletedCount > 0) {
          logger.info(
            `Deleted ${deletedCount} sessions for user ID: ${userId}`
          );
          logger.debug(`Active sessions count: ${sessions.size}`);
        }

        return deletedCount;
      } finally {
        handle.release();
      }
    },

    /**
     * Gets all active (non-expired) sessions
     * @returns Array of active sessions
     */
    getActiveSessions: getActiveSessions,

    /**
     * Gets the count of active sessions
     * @returns Number of active sessions
     */
    getActiveSessionCount: async (): Promise<number> => {
      const activeSessions = await getActiveSessions();
      return activeSessions.length;
    },

    /**
     * Manually triggers cleanup of expired sessions
     * @returns Number of sessions cleaned up
     */
    cleanup: async (): Promise<number> => {
      return await cleanupExpiredSessions();
    },
  };
};
