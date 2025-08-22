// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { readFile, writeFile, access, constants } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { createAsyncLock } from 'async-primitives';
import { Logger } from '../types';
import { generateSalt, hashPassword, verifyPassword, generateApiKey, generateUserId } from '../utils/crypto';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);
const accessAsync = promisify(access);

/**
 * User data structure
 */
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  apiKeyHash: string;
  apiKeySalt: string;
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
 * User creation response (includes generated API key)
 */
export interface CreateUserResponse {
  user: User;
  apiKey: string; // Only provided once during creation
}

/**
 * API key regeneration response
 */
export interface RegenerateApiKeyResponse {
  apiKey: string;
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
  initialize(): Promise<void>;
  destroy(): void;
  createUser(request: CreateUserRequest): Promise<CreateUserResponse>;
  getUser(username: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  updateUser(username: string, updates: Partial<Pick<User, 'role'>>): Promise<User | null>;
  deleteUser(username: string): Promise<boolean>;
  regenerateApiKey(username: string): Promise<RegenerateApiKeyResponse | null>;
  validateCredentials(username: string, password: string): Promise<User | null>;
  validateApiKey(username: string, apiKey: string): Promise<User | null>;
  getUserCount(): Promise<number>;
  isReady(): boolean;
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
  const fileLock = createAsyncLock();

  /**
   * Loads users from the JSON file with exclusive lock
   */
  const loadUsers = async (): Promise<void> => {
    const handle = await fileLock.lock();
    try {
      // Check if file exists
      await accessAsync(usersFilePath, constants.R_OK);
      
      // Read and parse file
      const content = await readFileAsync(usersFilePath, 'utf-8');
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
      await writeFileAsync(usersFilePath, content, 'utf-8');
      logger.debug(`Saved ${usersArray.length} users to users.json`);
    } catch (error: any) {
      logger.error(`Failed to save users.json: ${error.message}`);
      throw error;
    }
  };

  /**
   * Saves users to the JSON file with exclusive lock
   */
  const saveUsers = async (): Promise<void> => {
    const handle = await fileLock.lock();
    try {
      await saveUsersInternal();
    } finally {
      handle.release();
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
    async initialize(): Promise<void> {
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
    destroy(): void {
      users.clear();
      isInitialized = false;
    },

    /**
     * Creates a new user with generated API key
     * @param request - User creation request
     * @returns User creation response with API key
     */
    async createUser(request: CreateUserRequest): Promise<CreateUserResponse> {
      const handle = await fileLock.lock();
      try {
        validateUsername(request.username);
        validatePassword(request.password);
        validateRole(request.role);

        // Generate salts and hashes
        const passwordSalt = generateSalt();
        const passwordHash = hashPassword(request.password, passwordSalt);
        
        const apiKey = generateApiKey();
        const apiKeySalt = generateSalt();
        const apiKeyHash = hashPassword(apiKey, apiKeySalt);

        const now = new Date().toISOString();
        const user: User = {
          id: generateUserId(),
          username: request.username,
          passwordHash,
          salt: passwordSalt,
          apiKeyHash,
          apiKeySalt,
          role: request.role,
          createdAt: now,
          updatedAt: now
        };

        users.set(request.username, user);
        await saveUsersInternal();

        logger.info(`Created user: ${request.username} with role: ${request.role}`);

        return {
          user,
          apiKey // Only provided once during creation
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
    async getUser(username: string): Promise<User | null> {
      return users.get(username) || null;
    },

    /**
     * Gets all users
     * @returns Array of all users
     */
    async getAllUsers(): Promise<User[]> {
      return Array.from(users.values());
    },

    /**
     * Updates user properties
     * @param username - Username to update
     * @param updates - Properties to update
     * @returns Updated user or null if not found
     */
    async updateUser(username: string, updates: Partial<Pick<User, 'role'>>): Promise<User | null> {
      const handle = await fileLock.lock();
      try {
        const user = users.get(username);
        if (!user) {
          return null;
        }

        if (updates.role) {
          validateRole(updates.role);
          user.role = updates.role;
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
    async deleteUser(username: string): Promise<boolean> {
      const handle = await fileLock.lock();
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
     * Regenerates API key for a user
     * @param username - Username to regenerate API key for
     * @returns New API key or null if user not found
     */
    async regenerateApiKey(username: string): Promise<RegenerateApiKeyResponse | null> {
      const handle = await fileLock.lock();
      try {
        const user = users.get(username);
        if (!user) {
          return null;
        }

        const newApiKey = generateApiKey();
        const newApiKeySalt = generateSalt();
        const newApiKeyHash = hashPassword(newApiKey, newApiKeySalt);

        user.apiKeyHash = newApiKeyHash;
        user.apiKeySalt = newApiKeySalt;
        user.updatedAt = new Date().toISOString();

        await saveUsersInternal();
        logger.info(`Regenerated API key for user: ${username}`);

        return {
          apiKey: newApiKey
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
    async validateCredentials(username: string, password: string): Promise<User | null> {
      const user = users.get(username);
      if (!user) {
        return null;
      }

      const isValid = verifyPassword(password, user.passwordHash, user.salt);
      return isValid ? user : null;
    },

    /**
     * Validates API key for API access
     * @param username - Username
     * @param apiKey - API key
     * @returns User data if valid, null otherwise
     */
    async validateApiKey(username: string, apiKey: string): Promise<User | null> {
      const user = users.get(username);
      if (!user) {
        return null;
      }

      const isValid = verifyPassword(apiKey, user.apiKeyHash, user.apiKeySalt);
      return isValid ? user : null;
    },

    /**
     * Gets the total number of users
     * @returns User count
     */
    async getUserCount(): Promise<number> {
      return users.size;
    },

    /**
     * Checks if the service is ready
     * @returns True if initialized
     */
    isReady(): boolean {
      return isInitialized;
    }
  };
};