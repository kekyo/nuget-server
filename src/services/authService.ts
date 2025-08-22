// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Logger, AuthMode } from '../types';

/**
 * Authentication mode service configuration
 */
export interface AuthModeServiceConfig {
  authMode: AuthMode;
  logger: Logger;
}

/**
 * Authentication mode service interface for managing authentication requirements
 */
export interface AuthModeService {
  getAuthMode(): AuthMode;
  isAuthRequired(endpoint: 'general' | 'publish' | 'admin'): boolean;
}

/**
 * Legacy alias for backwards compatibility
 */
export type AuthService = AuthModeService;

/**
 * Creates an authentication mode service for managing authentication requirements
 * @param config - Authentication mode service configuration
 * @returns Authentication mode service instance
 */
export const createAuthService = (config: AuthModeServiceConfig): AuthModeService => {
  const { authMode, logger } = config;

  logger.info(`Authentication mode service initialized with mode: ${authMode}`);

  return {
    /**
     * Gets the current authentication mode
     * @returns Current authentication mode
     */
    getAuthMode(): AuthMode {
      return authMode;
    },

    /**
     * Checks if authentication is required for a specific endpoint based on auth mode
     * @param endpoint - The endpoint type to check
     * @returns True if authentication is required for the endpoint
     */
    isAuthRequired(endpoint: 'general' | 'publish' | 'admin'): boolean {
      switch (authMode) {
        case 'none':
          return false;
        case 'publish':
          return endpoint === 'publish' || endpoint === 'admin';
        case 'full':
          return true;
        default:
          return false;
      }
    }
  };
};