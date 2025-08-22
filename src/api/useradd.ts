// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response } from 'express';
import { Logger } from '../types';
import { UserService } from '../services/userService';

interface UserAddRequest {
  username: string;
  password: string;
  role: 'read' | 'publish' | 'admin';
}

interface UserAddResponse {
  success: boolean;
  message: string;
  apiKey?: string; // Only provided during user creation
}

interface UserListResponse {
  users: Array<{
    id: string;
    username: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

interface RegenerateApiKeyRequest {
  username: string;
}

interface RegenerateApiKeyResponse {
  success: boolean;
  message: string;
  apiKey?: string;
}

interface UserAddRouterInfo {
  router: Router;
  setUserService(userService: UserService): void;
  setConfigDir(configDir: string): void; // Keep for compatibility
}

/**
 * Creates the user registration router
 * @param logger - Logger instance
 * @returns Router information object
 */
export const createUserAddRouter = (logger: Logger): UserAddRouterInfo => {
  const router = Router();
  let configDir = '';
  let userService: UserService;

  const setConfigDir = (dir: string) => {
    configDir = dir;
  };

  const setUserService = (service: UserService) => {
    userService = service;
  };

  /**
   * GET /useradd - Get list of all users
   * Requires admin authentication
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const users = await userService.getAllUsers();
      
      const response: UserListResponse = {
        users: users.map(user => ({
          id: user.id,
          username: user.username,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }))
      };

      res.json(response);
    } catch (error: any) {
      logger.error(`Failed to get users: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve users'
      });
    }
  });

  /**
   * POST /useradd - Add a new user with automatic API key generation
   * Requires admin authentication
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { username, password, role }: UserAddRequest = req.body;

      logger.info(`Adding new user: ${username} with role: ${role}`);

      const result = await userService.createUser({
        username,
        password,
        role
      });

      logger.info(`User ${username} added successfully with role: ${role}`);

      const response: UserAddResponse = {
        success: true,
        message: 'User created successfully',
        apiKey: result.apiKey
      };

      res.status(201).json(response);

    } catch (error: any) {
      logger.error(`Failed to add user: ${error.message}`);
      
      const response: UserAddResponse = {
        success: false,
        message: error.message
      };
      
      res.status(400).json(response);
    }
  });

  /**
   * PUT /useradd/:username - Update user role
   * Requires admin authentication
   */
  router.put('/:username', async (req: Request, res: Response) => {
    try {
      const { username } = req.params;
      const { role } = req.body;

      if (!role) {
        return res.status(400).json({
          success: false,
          message: 'Role is required'
        });
      }

      logger.info(`Updating user ${username} role to: ${role}`);

      const user = await userService.updateUser(username, { role });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      logger.info(`User ${username} role updated successfully to: ${role}`);

      res.json({
        success: true,
        message: 'User role updated successfully'
      });

    } catch (error: any) {
      logger.error(`Failed to update user: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * DELETE /useradd/:username - Delete user
   * Requires admin authentication
   */
  router.delete('/:username', async (req: Request, res: Response) => {
    try {
      const { username } = req.params;

      logger.info(`Deleting user: ${username}`);

      const deleted = await userService.deleteUser(username);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      logger.info(`User ${username} deleted successfully`);

      res.json({
        success: true,
        message: 'User deleted successfully'
      });

    } catch (error: any) {
      logger.error(`Failed to delete user: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to delete user'
      });
    }
  });

  /**
   * POST /useradd/:username/regenerate-api-key - Regenerate user's API key
   * Requires admin authentication
   */
  router.post('/:username/regenerate-api-key', async (req: Request, res: Response) => {
    try {
      const { username } = req.params;

      logger.info(`Regenerating API key for user: ${username}`);

      const result = await userService.regenerateApiKey(username);
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      logger.info(`API key regenerated successfully for user: ${username}`);

      const response: RegenerateApiKeyResponse = {
        success: true,
        message: 'API key regenerated successfully',
        apiKey: result.apiKey
      };

      res.json(response);

    } catch (error: any) {
      logger.error(`Failed to regenerate API key: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to regenerate API key'
      });
    }
  });

  return {
    router,
    setUserService,
    setConfigDir
  };
};