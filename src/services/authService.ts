// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { readFile, access, constants, watch, FSWatcher } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { HtpasswdUser, parseHtpasswd, createUserMap } from '../utils/htpasswd';
import { Logger } from '../types';

const readFileAsync = promisify(readFile);
const accessAsync = promisify(access);

/**
 * Authentication service configuration
 */
export interface AuthServiceConfig {
  configDir: string;
  logger: Logger;
}

/**
 * Authentication service interface that manages htpasswd files
 */
export interface AuthService {
  initialize(): Promise<void>;
  destroy(): void;
  getPublishUsers(): Map<string, HtpasswdUser>;
  getGeneralUsers(): Map<string, HtpasswdUser>;
  isReady(): boolean;
  waitForInitialization(): Promise<void>;
  isPublishAuthEnabled(): boolean;
  isGeneralAuthEnabled(): boolean;
  reload(): Promise<void>;
}

/**
 * Creates an authentication service instance for managing htpasswd files
 * @param config - Authentication service configuration
 * @returns Authentication service instance
 */
export const createAuthService = (config: AuthServiceConfig): AuthService => {
  const { configDir, logger } = config;
  let publishUsers: Map<string, HtpasswdUser> = new Map();
  let generalUsers: Map<string, HtpasswdUser> = new Map();
  const watchers: FSWatcher[] = [];
  let isInitialized = false;
  let initializationPromise: Promise<void> | null = null;
  const debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Loads a specific htpasswd file
   * @param filename - Name of the htpasswd file
   * @param type - Type of authentication (publish or general)
   */
  const loadHtpasswdFile = async (filename: string, type: 'publish' | 'general'): Promise<void> => {
    const filePath = join(configDir, filename);
    const loadStartTime = Date.now();
    
    logger.debug(`[${new Date().toISOString()}] Loading ${filename} for ${type} authentication`);
    
    try {
      // Check if file exists
      await accessAsync(filePath, constants.R_OK);
      
      // Read and parse file
      const content = await readFileAsync(filePath, 'utf-8');
      const users = parseHtpasswd(content);
      const userMap = createUserMap(users);
      
      if (type === 'publish') {
        publishUsers = userMap;
        logger.info(`[${new Date().toISOString()}] Loaded ${users.length} users from ${filename} for publish authentication`);
      } else {
        generalUsers = userMap;
        logger.info(`[${new Date().toISOString()}] Loaded ${users.length} users from ${filename} for general authentication`);
      }
      
      // Log user details (without passwords)
      for (const user of users) {
        logger.debug(`[${new Date().toISOString()}] User: ${user.username} (${user.hashType} hash) - ${type} auth`);
      }
      
      const loadDuration = Date.now() - loadStartTime;
      logger.debug(`[${new Date().toISOString()}] ${filename} loaded successfully in ${loadDuration}ms`);
      
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.info(`[${new Date().toISOString()}] ${filename} not found - ${type} authentication disabled`);
        if (type === 'publish') {
          publishUsers.clear();
        } else {
          generalUsers.clear();
        }
      } else {
        logger.error(`[${new Date().toISOString()}] Failed to load ${filename}: ${error.message}`);
        throw error;
      }
    }
  };

  /**
   * Loads htpasswd files from the configuration directory sequentially
   * to avoid race conditions when both files exist
   */
  const loadHtpasswdFiles = async (): Promise<void> => {
    logger.debug(`[${new Date().toISOString()}] Starting htpasswd files loading`);
    
    // Load publish authentication file first
    try {
      await loadHtpasswdFile('htpasswd-publish', 'publish');
    } catch (error) {
      logger.error(`Failed to load htpasswd-publish: ${error}`);
      // Continue with general auth file even if publish fails
    }
    
    // Then load general authentication file
    try {
      await loadHtpasswdFile('htpasswd', 'general');
    } catch (error) {
      logger.error(`Failed to load htpasswd: ${error}`);
      // Don't throw - partial initialization is acceptable
    }
    
    logger.info(`[${new Date().toISOString()}] Htpasswd files loading completed - publish: ${publishUsers.size} users, general: ${generalUsers.size} users`);
  };

  /**
   * Schedules a retry to set up file watcher after a delay
   */
  const scheduleFileWatcherRetry = (filename: string, type: 'publish' | 'general'): void => {
    const retryKey = `retry-${filename}`;
    
    // Clear existing retry timer
    if (debounceTimers.has(retryKey)) {
      clearTimeout(debounceTimers.get(retryKey)!);
    }
    
    // Schedule retry in 5 seconds
    const timer = setTimeout(() => {
      debounceTimers.delete(retryKey);
      setupFileWatcher(filename, type);
    }, 5000);
    
    debounceTimers.set(retryKey, timer);
  };

  /**
   * Debounced reload function to prevent multiple rapid reloads
   */
  const debouncedReload = (filename: string, type: 'publish' | 'general'): void => {
    const debounceKey = `reload-${filename}`;
    
    // Clear existing timer
    if (debounceTimers.has(debounceKey)) {
      clearTimeout(debounceTimers.get(debounceKey)!);
    }
    
    // Set new timer for 500ms debounce
    const timer = setTimeout(async () => {
      debounceTimers.delete(debounceKey);
      logger.info(`[${new Date().toISOString()}] ${filename} changed - reloading (debounced)`);
      
      try {
        await loadHtpasswdFile(filename, type);
        logger.info(`[${new Date().toISOString()}] ${filename} reloaded successfully`);
      } catch (error) {
        logger.error(`[${new Date().toISOString()}] Failed to reload ${filename}: ${error}`);
        
        // If file was deleted, clear users and try to set up watcher again
        if ((error as any).code === 'ENOENT') {
          if (type === 'publish') {
            publishUsers.clear();
            logger.info(`[${new Date().toISOString()}] Cleared publish users due to missing file`);
          } else {
            generalUsers.clear();
            logger.info(`[${new Date().toISOString()}] Cleared general users due to missing file`);
          }
          
          // Retry setting up watcher
          scheduleFileWatcherRetry(filename, type);
        }
      }
    }, 500); // 500ms debounce
    
    debounceTimers.set(debounceKey, timer);
  };

  /**
   * Sets up a file watcher for a specific htpasswd file with debouncing
   */
  const setupFileWatcher = (filename: string, type: 'publish' | 'general'): void => {
    const filePath = join(configDir, filename);
    
    try {
      const watcher = watch(filePath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          debouncedReload(filename, type);
        }
      });
      
      watchers.push(watcher);
      logger.debug(`[${new Date().toISOString()}] Watching ${filename} for changes`);
      
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug(`[${new Date().toISOString()}] Could not watch ${filename}: file does not exist (will retry if created)`);
      } else {
        logger.warn(`[${new Date().toISOString()}] Could not watch ${filename}: ${error}`);
      }
      
      // Set up periodic retry for file creation
      scheduleFileWatcherRetry(filename, type);
    }
  };

  /**
   * Sets up file system watchers to automatically reload htpasswd files with debouncing
   */
  const setupFileWatchers = (): void => {
    const filesToWatch = [
      { filename: 'htpasswd-publish', type: 'publish' as const },
      { filename: 'htpasswd', type: 'general' as const }
    ];

    for (const { filename, type } of filesToWatch) {
      setupFileWatcher(filename, type);
    }
  };

  const doInitialize = async (): Promise<void> => {
    if (isInitialized) {
      return;
    }

    const startTime = Date.now();
    logger.info(`[${new Date().toISOString()}] Initializing auth service with config directory: ${configDir}`);
    
    await loadHtpasswdFiles();
    setupFileWatchers();
    
    isInitialized = true;
    const duration = Date.now() - startTime;
    logger.info(`[${new Date().toISOString()}] Auth service initialization completed in ${duration}ms`);
  };

  return {
    /**
     * Initializes the authentication service and loads htpasswd files
     */
    async initialize(): Promise<void> {
      if (initializationPromise) {
        return initializationPromise;
      }

      initializationPromise = doInitialize();
      return initializationPromise;
    },

    /**
     * Destroys the authentication service and cleans up resources
     */
    destroy(): void {
      // Clear debounce timers
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      
      // Close file watchers
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers.length = 0;
      
      isInitialized = false;
      initializationPromise = null;
    },

    /**
     * Gets users configured for publish authentication
     * @returns Map of publish users
     */
    getPublishUsers(): Map<string, HtpasswdUser> {
      return publishUsers;
    },

    /**
     * Gets users configured for general authentication
     * @returns Map of general users
     */
    getGeneralUsers(): Map<string, HtpasswdUser> {
      return generalUsers;
    },

    /**
     * Checks if the service has completed initialization
     * @returns True if initialization is complete
     */
    isReady(): boolean {
      return isInitialized;
    },

    /**
     * Waits for initialization to complete
     */
    async waitForInitialization(): Promise<void> {
      if (initializationPromise) {
        await initializationPromise;
      }
    },

    /**
     * Checks if publish authentication is enabled
     * @returns True if publish authentication is configured
     */
    isPublishAuthEnabled(): boolean {
      return publishUsers.size > 0;
    },

    /**
     * Checks if general authentication is enabled
     * @returns True if general authentication is configured
     */
    isGeneralAuthEnabled(): boolean {
      return generalUsers.size > 0;
    },

    /**
     * Manually reload authentication files (useful for testing)
     */
    async reload(): Promise<void> {
      await loadHtpasswdFiles();
    }
  };
};