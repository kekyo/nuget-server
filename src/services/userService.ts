// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { constants } from 'fs';
import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { createReaderWriterLock } from 'async-primitives';
import { Logger } from '../types';
import { generateSalt, hashPassword, verifyPassword, generateApiPassword, generateUserId } from '../utils/crypto';

/**
 * User data structure
 */
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  apiPasswordHash: string;
  apiPasswordSalt: string;
  role: 'read' | 'publish' | 'admin';
  createdAt: string;
  updatedAt: string;
}

/**
 * User creation request
 */
export interface CreateUserRequest {
  username: string;
  password: string;
  role: 'read' | 'publish' | 'admin';
}

/**
 * User creation response (includes generated API password)
 */
export interface CreateUserResponse {
  user: User;
  apiPassword: string; // Only provided once during creation
}

/**
 * API password regeneration response
 */
export interface RegenerateApiPasswordResponse {
  apiPassword: string;
}

/**
 * User service configuration
 */
export interface UserServiceConfig {
  configDir: string;
  logger: Logger;
}

/**
 * User service interface for managing JSON-based user data
 */
export interface UserService {
  readonly initialize: () => Promise<void>;
  readonly destroy: () => void;
  readonly createUser: (request: CreateUserRequest) => Promise<CreateUserResponse>;
  readonly getUser: (username: string) => Promise<User | null>;
  readonly getAllUsers: () => Promise<User[]>;
  readonly updateUser: (username: string, updates: Partial<Pick<User, 'role'>> | { password: string }) => Promise<User | null>;
  readonly deleteUser: (username: string) => Promise<boolean>;
  readonly regenerateApiPassword: (username: string) => Promise<RegenerateApiPasswordResponse | null>;
  readonly validateCredentials: (username: string, password: string) => Promise<User | null>;
  readonly validateApiPassword: (username: string, apiPassword: string) => Promise<User | null>;
  readonly getUserCount: () => Promise<number>;
  readonly isReady: () => boolean;
}

/**
 * Creates a user service instance for managing JSON-based user data
 * @param config - User service configuration
 * @returns User service instance
 */
export const createUserService = (config: UserServiceConfig): UserService => {
  const { configDir, logger } = config;
  const usersFilePath = join(configDir, 'users.json');
  let users: Map<string, User> = new Map();
  let isInitialized = false;
  const fileLock = createReaderWriterLock();

  /**
   * Loads users from the JSON file with exclusive lock
   */
  const loadUsers = async (): Promise<void> => {
    const handle = await fileLock.readLock();
    try {
      // Check if file exists
      await access(usersFilePath, constants.R_OK);
      
      // Read and parse file
      const content = await readFile(usersFilePath, 'utf-8');
      const usersArray: User[] = JSON.parse(content);
      
      users.clear();
      for (const user of usersArray) {
        users.set(user.username, user);
      }
      
      logger.info(`Loaded ${usersArray.length} users from users.json`);
      
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.info('users.json not found - starting with empty user database');
        users.clear();
      } else {
        logger.error(`Failed to load users.json: ${error.message}`);
        throw error;
      }
    } finally {
      handle.release();
    }
  };

  /**
   * Internal save function (called from within lock)
   */
  const saveUsersInternal = async (): Promise<void> => {
    try {
      const usersArray = Array.from(users.values());
      const content = JSON.stringify(usersArray, null, 2);
      await writeFile(usersFilePath, content, 'utf-8');
      logger.debug(`Saved ${usersArray.length} users to users.json`);
    } catch (error: any) {
      logger.error(`Failed to save users.json: ${error.message}`);
      throw error;
    }
  };

  /**
   * Validates username format and uniqueness
   */
  const validateUsername = (username: string, excludeExisting = false): void => {
    if (!username || username.trim().length === 0) {
      throw new Error('Username cannot be empty');
    }

    if (username.length > 50) {
      throw new Error('Username cannot exceed 50 characters');
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      throw new Error('Username can only contain letters, numbers, dots, underscores, and hyphens');
    }

    if (!excludeExisting && users.has(username)) {
      throw new Error('Username already exists');
    }
  };

  /**
   * Validates password strength
   */
  const validatePassword = (password: string): void => {
    if (!password || password.length === 0) {
      throw new Error('Password cannot be empty');
    }

    if (password.length < 4) {
      throw new Error('Password must be at least 4 characters long');
    }
  };

  /**
   * Validates role
   */
  const validateRole = (role: string): void => {
    if (!['read', 'publish', 'admin'].includes(role)) {
      throw new Error('Role must be one of: read, publish, admin');
    }
  };

  return {
    /**
     * Initializes the user service and loads user data
     */
    initialize: async (): Promise<void> => {
      if (isInitialized) {
        return;
      }

      const startTime = Date.now();
      logger.info(`Initializing user service with config directory: ${configDir}`);
      
      await loadUsers();
      
      isInitialized = true;
      const duration = Date.now() - startTime;
      logger.info(`User service initialization completed in ${duration}ms`);
    },

    /**
     * Destroys the user service and cleans up resources
     */
    destroy: (): void => {
      users.clear();
      isInitialized = false;
    },

    /**
     * Creates a new user with generated API password
     * @param request - User creation request
     * @returns User creation response with API password
     */
    createUser: async (request: CreateUserRequest): Promise<CreateUserResponse> => {
      const handle = await fileLock.writeLock();
      try {
        validateUsername(request.username);
        validatePassword(request.password);
        validateRole(request.role);

        // Generate salts and hashes
        const passwordSalt = generateSalt();
        const passwordHash = hashPassword(request.password, passwordSalt);
        
        const apiPassword = generateApiPassword();
        const apiPasswordSalt = generateSalt();
        const apiPasswordHash = hashPassword(apiPassword, apiPasswordSalt);

        const now = new Date().toISOString();
        const user: User = {
          id: generateUserId(),
          username: request.username,
          passwordHash,
          salt: passwordSalt,
          apiPasswordHash,
          apiPasswordSalt,
          role: request.role,
          createdAt: now,
          updatedAt: now
        };

        users.set(request.username, user);
        await saveUsersInternal();

        logger.info(`Created user: ${request.username} with role: ${request.role}`);

        return {
          user,
          apiPassword // Only provided once during creation
        };
      } finally {
        handle.release();
      }
    },

    /**
     * Gets a user by username
     * @param username - Username to look up
     * @returns User data or null if not found
     */
    getUser: async (username: string): Promise<User | null> => {
      return users.get(username) || null;
    },

    /**
     * Gets all users
     * @returns Array of all users
     */
    getAllUsers: async (): Promise<User[]> => {
      return Array.from(users.values());
    },

    /**
     * Updates user properties
     * @param username - Username to update
     * @param updates - Properties to update
     * @returns Updated user or null if not found
     */
    updateUser: async (username: string, updates: Partial<Pick<User, 'role'>> | { password: string }): Promise<User | null> => {
      const handle = await fileLock.writeLock();
      try {
        const user = users.get(username);
        if (!user) {
          return null;
        }

        if ('role' in updates && updates.role) {
          validateRole(updates.role);
          user.role = updates.role;
        }

        if ('password' in updates && updates.password) {
          validatePassword(updates.password);
          const newPasswordSalt = generateSalt();
          const newPasswordHash = hashPassword(updates.password, newPasswordSalt);
          user.passwordHash = newPasswordHash;
          user.salt = newPasswordSalt;
        }

        user.updatedAt = new Date().toISOString();
        await saveUsersInternal();

        logger.info(`Updated user: ${username}`);
        return user;
      } finally {
        handle.release();
      }
    },

    /**
     * Deletes a user
     * @param username - Username to delete
     * @returns True if user was deleted, false if not found
     */
    deleteUser: async (username: string): Promise<boolean> => {
      const handle = await fileLock.writeLock();
      try {
        const deleted = users.delete(username);
        if (deleted) {
          await saveUsersInternal();
          logger.info(`Deleted user: ${username}`);
        }
        return deleted;
      } finally {
        handle.release();
      }
    },

    /**
     * Regenerates API password for a user
     * @param username - Username to regenerate API password for
     * @returns New API password or null if user not found
     */
    regenerateApiPassword: async (username: string): Promise<RegenerateApiPasswordResponse | null> => {
      const handle = await fileLock.writeLock();
      try {
        const user = users.get(username);
        if (!user) {
          return null;
        }

        const newApiPassword = generateApiPassword();
        const newApiPasswordSalt = generateSalt();
        const newApiPasswordHash = hashPassword(newApiPassword, newApiPasswordSalt);

        user.apiPasswordHash = newApiPasswordHash;
        user.apiPasswordSalt = newApiPasswordSalt;
        user.updatedAt = new Date().toISOString();

        await saveUsersInternal();
        logger.info(`Regenerated API password for user: ${username}`);

        return {
          apiPassword: newApiPassword
        };
      } finally {
        handle.release();
      }
    },

    /**
     * Validates user credentials for UI login
     * @param username - Username
     * @param password - Password
     * @returns User data if valid, null otherwise
     */
    validateCredentials: async (username: string, password: string): Promise<User | null> => {
      const user = users.get(username);
      if (!user) {
        return null;
      }

      const isValid = verifyPassword(password, user.passwordHash, user.salt);
      return isValid ? user : null;
    },

    /**
     * Validates API password for API access
     * @param username - Username
     * @param apiPassword - API password
     * @returns User data if valid, null otherwise
     */
    validateApiPassword: async (username: string, apiPassword: string): Promise<User | null> => {
      const user = users.get(username);
      if (!user) {
        return null;
      }

      const isValid = verifyPassword(apiPassword, user.apiPasswordHash, user.apiPasswordSalt);
      return isValid ? user : null;
    },

    /**
     * Gets the total number of users
     * @returns User count
     */
    getUserCount: async (): Promise<number> => {
      return users.size;
    },

    /**
     * Checks if the service is ready
     * @returns True if initialized
     */
    isReady: (): boolean => {
      return isInitialized;
    }
  };
};
