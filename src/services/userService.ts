// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { constants } from "fs";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { createReaderWriterLock } from "async-primitives";
import { Logger, ServerConfig } from "../types";
import {
  generateSalt,
  hashPassword,
  verifyPassword,
  generateApiPassword,
  generateUserId,
} from "../utils/crypto";
import {
  checkPasswordStrength,
  getMinPasswordScore,
} from "../utils/passwordStrength";

/**
 * API password data structure
 */
export interface ApiPassword {
  label: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

/**
 * User data structure
 */
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  apiPasswordHash?: string; // Deprecated - for backward compatibility
  apiPasswordSalt?: string; // Deprecated - for backward compatibility
  apiPasswords?: ApiPassword[]; // New field for multiple API passwords
  role: "read" | "publish" | "admin";
  createdAt: string;
  updatedAt: string;
}

/**
 * User creation request
 */
export interface CreateUserRequest {
  username: string;
  password: string;
  role: "read" | "publish" | "admin";
}

/**
 * API password regeneration response
 */
export interface RegenerateApiPasswordResponse {
  apiPassword: string;
}

/**
 * API password list response
 */
export interface ApiPasswordListResponse {
  apiPasswords: Array<{
    label: string;
    createdAt: string;
  }>;
}

/**
 * API password add response
 */
export interface ApiPasswordAddResponse {
  label: string;
  apiPassword: string;
  createdAt: string;
}

/**
 * API password delete response
 */
export interface ApiPasswordDeleteResponse {
  success: boolean;
  message: string;
}

/**
 * User service configuration
 */
export interface UserServiceConfig {
  configDir: string;
  usersFile?: string; // Optional custom path to users.json file
  logger: Logger;
  serverConfig?: ServerConfig;
}

/**
 * User service interface for managing JSON-based user data
 */
export interface UserService {
  readonly initialize: () => Promise<void>;
  readonly destroy: () => void;
  readonly createUser: (request: CreateUserRequest) => Promise<User>;
  readonly getUser: (username: string) => Promise<User | undefined>;
  readonly getAllUsers: () => Promise<User[]>;
  readonly updateUser: (
    username: string,
    updates: Partial<Pick<User, "role">> | { password: string },
  ) => Promise<User | undefined>;
  readonly deleteUser: (username: string) => Promise<boolean>;
  readonly regenerateApiPassword: (
    username: string,
  ) => Promise<RegenerateApiPasswordResponse | undefined>;
  readonly validateCredentials: (
    username: string,
    password: string,
  ) => Promise<User | undefined>;
  readonly validateApiPassword: (
    username: string,
    apiPassword: string,
  ) => Promise<User | undefined>;
  readonly getUserCount: () => Promise<number>;
  readonly isReady: () => boolean;
  // New methods for multiple API passwords
  readonly listApiPasswords: (
    username: string,
  ) => Promise<ApiPasswordListResponse | undefined>;
  readonly addApiPassword: (
    username: string,
    label: string,
  ) => Promise<ApiPasswordAddResponse | undefined>;
  readonly deleteApiPassword: (
    username: string,
    label: string,
  ) => Promise<ApiPasswordDeleteResponse>;
  readonly validateAnyApiPassword: (
    username: string,
    apiPassword: string,
  ) => Promise<User | undefined>;
}

/**
 * Creates a user service instance for managing JSON-based user data
 * @param config - User service configuration
 * @returns User service instance
 */
export const createUserService = (config: UserServiceConfig): UserService => {
  const { configDir, usersFile, logger, serverConfig } = config;
  // Use custom users file path if provided, otherwise default to configDir/users.json
  const usersFilePath = usersFile || join(configDir, "users.json");
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
      const content = await readFile(usersFilePath, "utf-8");
      const usersArray: User[] = JSON.parse(content);

      users.clear();
      for (const user of usersArray) {
        users.set(user.username, user);
      }

      logger.info(`Loaded ${usersArray.length} users from ${usersFilePath}`);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        logger.info(
          `${usersFilePath} not found - starting with empty user database`,
        );
        users.clear();
      } else {
        logger.error(`Failed to load ${usersFilePath}: ${error.message}`);
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
      await writeFile(usersFilePath, content, "utf-8");
      logger.debug(`Saved ${usersArray.length} users to ${usersFilePath}`);
    } catch (error: any) {
      logger.error(`Failed to save ${usersFilePath}: ${error.message}`);
      throw error;
    }
  };

  /**
   * Validates username format and uniqueness
   */
  const validateUsername = (
    username: string,
    excludeExisting = false,
  ): void => {
    if (!username || username.trim().length === 0) {
      throw new Error("Username cannot be empty");
    }

    if (username.length > 50) {
      throw new Error("Username cannot exceed 50 characters");
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      throw new Error(
        "Username can only contain letters, numbers, dots, underscores, and hyphens",
      );
    }

    if (!excludeExisting && users.has(username)) {
      throw new Error("Username already exists");
    }
  };

  /**
   * Validates password strength
   */
  const validatePassword = (password: string, username?: string): void => {
    if (!password || password.length === 0) {
      throw new Error("Password cannot be empty");
    }

    // Minimum length check (for backward compatibility)
    if (password.length < 4) {
      throw new Error("Password must be at least 4 characters long");
    }

    // Strength check (can be disabled via config)
    if (serverConfig?.passwordStrengthCheck !== false) {
      const userInputs = username ? [username] : [];
      const strengthResult = checkPasswordStrength(password, userInputs);
      const minScore = getMinPasswordScore(serverConfig);

      if (strengthResult.score < minScore) {
        const strengthLabel = ["Weak", "Fair", "Good", "Strong", "Very Strong"][
          minScore
        ];
        throw new Error(
          `Password strength is too weak. Minimum required: ${strengthLabel}. ` +
            (strengthResult.feedback.warning ||
              strengthResult.feedback.suggestions[0] ||
              ""),
        );
      }
    }
  };

  /**
   * Validates role
   */
  const validateRole = (role: string): void => {
    if (!["read", "publish", "admin"].includes(role)) {
      throw new Error("Role must be one of: read, publish, admin");
    }
  };

  const service: UserService = {
    /**
     * Initializes the user service and loads user data
     */
    initialize: async (): Promise<void> => {
      if (isInitialized) {
        return;
      }

      const startTime = Date.now();
      logger.info(
        `Initializing user service with config directory: ${configDir}`,
      );

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
     * Creates a new user
     * @param request - User creation request
     * @returns Created user
     */
    createUser: async (request: CreateUserRequest): Promise<User> => {
      const handle = await fileLock.writeLock();
      try {
        validateUsername(request.username);
        validatePassword(request.password, request.username);
        validateRole(request.role);

        // Generate salts and hashes
        const passwordSalt = generateSalt();
        const passwordHash = hashPassword(request.password, passwordSalt);

        const now = new Date().toISOString();
        const user: User = {
          id: generateUserId(),
          username: request.username,
          passwordHash,
          salt: passwordSalt,
          apiPasswords: [], // Start with empty API passwords array
          role: request.role,
          createdAt: now,
          updatedAt: now,
        };

        users.set(request.username, user);
        await saveUsersInternal();

        logger.info(
          `Created user: ${request.username} with role: ${request.role}`,
        );

        return user;
      } finally {
        handle.release();
      }
    },

    /**
     * Gets a user by username
     * @param username - Username to look up
     * @returns User data or undefined if not found
     */
    getUser: async (username: string): Promise<User | undefined> => {
      return users.get(username);
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
     * @returns Updated user or undefined if not found
     */
    updateUser: async (
      username: string,
      updates: Partial<Pick<User, "role">> | { password: string },
    ): Promise<User | undefined> => {
      const handle = await fileLock.writeLock();
      try {
        const user = users.get(username);
        if (!user) {
          return undefined;
        }

        if ("role" in updates && updates.role) {
          validateRole(updates.role);
          user.role = updates.role;
        }

        if ("password" in updates && updates.password) {
          validatePassword(updates.password, username);
          const newPasswordSalt = generateSalt();
          const newPasswordHash = hashPassword(
            updates.password,
            newPasswordSalt,
          );
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
     * @returns New API password or undefined if user not found
     */
    regenerateApiPassword: async (
      username: string,
    ): Promise<RegenerateApiPasswordResponse | undefined> => {
      const handle = await fileLock.writeLock();
      try {
        const user = users.get(username);
        if (!user) {
          return undefined;
        }

        const newApiPassword = generateApiPassword();
        const newApiPasswordSalt = generateSalt();
        const newApiPasswordHash = hashPassword(
          newApiPassword,
          newApiPasswordSalt,
        );

        user.apiPasswordHash = newApiPasswordHash;
        user.apiPasswordSalt = newApiPasswordSalt;
        user.updatedAt = new Date().toISOString();

        await saveUsersInternal();
        logger.info(`Regenerated API password for user: ${username}`);

        return {
          apiPassword: newApiPassword,
        };
      } finally {
        handle.release();
      }
    },

    /**
     * Validates user credentials for UI login
     * @param username - Username
     * @param password - Password
     * @returns User data if valid, undefined otherwise
     */
    validateCredentials: async (
      username: string,
      password: string,
    ): Promise<User | undefined> => {
      const user = users.get(username);
      if (!user) {
        return undefined;
      }

      const isValid = verifyPassword(password, user.passwordHash, user.salt);
      return isValid ? user : undefined;
    },

    /**
     * Validates API password for API access
     * @param username - Username
     * @param apiPassword - API password
     * @returns User data if valid, undefined otherwise
     */
    validateApiPassword: async (
      username: string,
      apiPassword: string,
    ): Promise<User | undefined> => {
      const user = users.get(username);
      if (!user) {
        return undefined;
      }

      // First check new apiPasswords array
      if (user.apiPasswords && user.apiPasswords.length > 0) {
        for (const apiPwd of user.apiPasswords) {
          const isValid = verifyPassword(
            apiPassword,
            apiPwd.passwordHash,
            apiPwd.salt,
          );
          if (isValid) {
            return user;
          }
        }
      } else if (user.apiPasswordHash && user.apiPasswordSalt) {
        // Fallback to old single API password for backward compatibility
        const isValid = verifyPassword(
          apiPassword,
          user.apiPasswordHash,
          user.apiPasswordSalt,
        );
        if (isValid) {
          return user;
        }
      }

      return undefined;
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
    },

    /**
     * Lists all API passwords for a user
     * @param username - Username
     * @returns API password list or undefined if user not found
     */
    listApiPasswords: async (
      username: string,
    ): Promise<ApiPasswordListResponse | undefined> => {
      const user = users.get(username);
      if (!user) {
        return undefined;
      }

      // Initialize apiPasswords array if it doesn't exist (backward compatibility)
      if (!user.apiPasswords) {
        user.apiPasswords = [];
        // Migrate old single API password if it exists
        if (user.apiPasswordHash && user.apiPasswordSalt) {
          user.apiPasswords.push({
            label: "default",
            passwordHash: user.apiPasswordHash,
            salt: user.apiPasswordSalt,
            createdAt: user.createdAt,
          });
        }
      }

      // Sort by createdAt in descending order (newest first)
      const sortedPasswords = [...user.apiPasswords].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return {
        apiPasswords: sortedPasswords.map((p) => ({
          label: p.label,
          createdAt: p.createdAt,
        })),
      };
    },

    /**
     * Adds a new API password for a user
     * @param username - Username
     * @param label - Label for the API password
     * @returns New API password or undefined if user not found
     */
    addApiPassword: async (
      username: string,
      label: string,
    ): Promise<ApiPasswordAddResponse | undefined> => {
      const handle = await fileLock.writeLock();
      try {
        const user = users.get(username);
        if (!user) {
          return undefined;
        }

        // Validate label
        if (!label || label.trim().length === 0) {
          throw new Error("Label cannot be empty");
        }

        if (label.length > 50) {
          throw new Error("Label cannot exceed 50 characters");
        }

        // Initialize apiPasswords array if it doesn't exist
        if (!user.apiPasswords) {
          user.apiPasswords = [];
          // Migrate old single API password if it exists
          if (user.apiPasswordHash && user.apiPasswordSalt) {
            user.apiPasswords.push({
              label: "default",
              passwordHash: user.apiPasswordHash,
              salt: user.apiPasswordSalt,
              createdAt: user.createdAt,
            });
          }
        }

        // Check for duplicate label
        if (user.apiPasswords.some((p) => p.label === label)) {
          throw new Error(`API password with label "${label}" already exists`);
        }

        // Check maximum limit (10 API passwords)
        if (user.apiPasswords.length >= 10) {
          throw new Error("Maximum of 10 API passwords allowed per user");
        }

        // Generate new API password
        const apiPassword = generateApiPassword();
        const salt = generateSalt();
        const passwordHash = hashPassword(apiPassword, salt);
        const now = new Date().toISOString();

        // Add new API password
        user.apiPasswords.push({
          label,
          passwordHash,
          salt,
          createdAt: now,
        });

        user.updatedAt = now;
        await saveUsersInternal();

        logger.info(
          `Added API password with label "${label}" for user: ${username}`,
        );

        return {
          label,
          apiPassword,
          createdAt: now,
        };
      } finally {
        handle.release();
      }
    },

    /**
     * Deletes an API password for a user
     * @param username - Username
     * @param label - Label of the API password to delete
     * @returns Delete response
     */
    deleteApiPassword: async (
      username: string,
      label: string,
    ): Promise<ApiPasswordDeleteResponse> => {
      const handle = await fileLock.writeLock();
      try {
        const user = users.get(username);
        if (!user) {
          return {
            success: false,
            message: "User not found",
          };
        }

        // Initialize apiPasswords array if it doesn't exist
        if (!user.apiPasswords) {
          user.apiPasswords = [];
        }

        // Find and remove the API password with the specified label
        const initialLength = user.apiPasswords.length;
        user.apiPasswords = user.apiPasswords.filter((p) => p.label !== label);

        if (user.apiPasswords.length === initialLength) {
          return {
            success: false,
            message: `API password with label "${label}" not found`,
          };
        }

        user.updatedAt = new Date().toISOString();
        await saveUsersInternal();

        logger.info(
          `Deleted API password with label "${label}" for user: ${username}`,
        );

        return {
          success: true,
          message: `API password "${label}" deleted successfully`,
        };
      } finally {
        handle.release();
      }
    },

    /**
     * Validates any API password for a user (for authentication)
     * @param username - Username
     * @param apiPassword - API password to validate
     * @returns User data if valid, undefined otherwise
     */
    validateAnyApiPassword: async (
      username: string,
      apiPassword: string,
    ): Promise<User | undefined> => {
      // This is essentially the same as validateApiPassword now
      return service.validateApiPassword(username, apiPassword);
    },
  };

  return service;
};
