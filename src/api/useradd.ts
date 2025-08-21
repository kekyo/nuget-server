// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response } from 'express';
import { promisify } from 'util';
import { appendFile } from 'fs';
import { join } from 'path';
import { Logger } from '../types';
import { generateSha1Hash, formatHtpasswdEntry } from '../utils/htpasswd';

const appendFileAsync = promisify(appendFile);

interface UserAddRequest {
  username: string;
  password: string;
  role: 'readonly' | 'read-publish' | 'admin';
}

interface UserAddRouterInfo {
  router: Router;
  setConfigDir(configDir: string): void;
}

/**
 * Creates the user registration router
 * @param logger - Logger instance
 * @returns Router information object
 */
export const createUserAddRouter = (logger: Logger): UserAddRouterInfo => {
  const router = Router();
  let configDir = '';

  const setConfigDir = (dir: string) => {
    configDir = dir;
  };

  /**
   * POST /useradd - Add a new user to the appropriate htpasswd file
   * Requires admin authentication
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { username, password, role }: UserAddRequest = req.body;

      // Validate input
      if (!username || !password || !role) {
        return res.status(400).json({ 
          error: 'Missing required fields: username, password, and role are required' 
        });
      }

      // Validate username format (basic validation)
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return res.status(400).json({ 
          error: 'Username must contain only alphanumeric characters, hyphens, and underscores' 
        });
      }

      // Validate role
      if (!['readonly', 'read-publish', 'admin'].includes(role)) {
        return res.status(400).json({ 
          error: 'Role must be one of: readonly, read-publish, admin' 
        });
      }

      // Validate password strength (minimum requirements)
      if (password.length < 4) {
        return res.status(400).json({ 
          error: 'Password must be at least 4 characters long' 
        });
      }

      logger.info(`Adding new user: ${username} with role: ${role}`);

      // Generate SHA1 hash for the password
      const passwordHash = generateSha1Hash(password);
      const htpasswdEntry = formatHtpasswdEntry(username, passwordHash);

      // Determine which htpasswd file to write to based on role
      let filename: string;
      switch (role) {
        case 'readonly':
          filename = 'htpasswd';
          break;
        case 'read-publish':
          filename = 'htpasswd-publish';
          break;
        case 'admin':
          filename = 'htpasswd-admin';
          break;
        default:
          return res.status(400).json({ error: 'Invalid role' });
      }

      const filePath = join(configDir, filename);

      // Append the new user entry to the appropriate file
      await appendFileAsync(filePath, `${htpasswdEntry}\n`, 'utf-8');

      logger.info(`User ${username} added successfully to ${filename} with ${role} permissions`);

      res.status(201).json({
        message: 'User added successfully',
        username,
        role,
        file: filename
      });

    } catch (error: any) {
      logger.error(`Failed to add user: ${error.message}`);
      res.status(500).json({ 
        error: 'Failed to add user', 
        details: error.message 
      });
    }
  });

  return {
    router,
    setConfigDir
  };
};