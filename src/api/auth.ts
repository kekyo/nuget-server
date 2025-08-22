// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Router, Request, Response } from 'express';
import { Logger } from '../types';
import { UserService } from '../services/userService';
import { SessionService } from '../services/sessionService';

/**
 * Login request body
 */
interface LoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * Login response body
 */
interface LoginResponse {
  success: boolean;
  message: string;
  user?: {
    username: string;
    role: string;
  };
}

/**
 * Session response body
 */
interface SessionResponse {
  authenticated: boolean;
  user?: {
    username: string;
    role: string;
  };
}

/**
 * Logout response body
 */
interface LogoutResponse {
  success: boolean;
  message: string;
}

/**
 * Creates authentication API router
 * @param logger - Logger instance
 * @returns Authentication router and configuration methods
 */
export const createAuthRouter = (logger: Logger) => {
  const router = Router();
  let userService: UserService;
  let sessionService: SessionService;

  /**
   * POST /api/auth/login - User login endpoint
   */
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { username, password, rememberMe = false }: LoginRequest = req.body;

      if (!username || !password) {
        const response: LoginResponse = {
          success: false,
          message: 'Username and password are required'
        };
        return res.status(400).json(response);
      }

      // Validate user credentials
      const user = await userService.validateCredentials(username, password);
      if (!user) {
        logger.warn(`Failed login attempt for user: ${username}`);
        const response: LoginResponse = {
          success: false,
          message: 'Invalid username or password'
        };
        return res.status(401).json(response);
      }

      // Create session
      const expirationHours = rememberMe ? 24 * 7 : 24; // 7 days if remember me, otherwise 24 hours
      const session = sessionService.createSession({
        userId: user.id,
        username: user.username,
        role: user.role,
        expirationHours
      });

      // Set session cookie
      res.cookie('sessionToken', session.token, {
        httpOnly: true,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'strict',
        maxAge: expirationHours * 60 * 60 * 1000,
        path: '/'
      });

      logger.info(`User logged in: ${username}`);

      const response: LoginResponse = {
        success: true,
        message: 'Login successful',
        user: {
          username: user.username,
          role: user.role
        }
      };

      res.json(response);

    } catch (error) {
      logger.error(`Login error: ${error}`);
      const response: LoginResponse = {
        success: false,
        message: 'Internal server error'
      };
      res.status(500).json(response);
    }
  });

  /**
   * POST /api/auth/logout - User logout endpoint
   */
  router.post('/logout', (req: Request, res: Response) => {
    try {
      const sessionToken = req.cookies?.sessionToken;

      if (sessionToken) {
        const session = sessionService.getSession(sessionToken);
        if (session) {
          sessionService.deleteSession(sessionToken);
          logger.info(`User logged out: ${session.username}`);
        }
      }

      // Clear session cookie
      res.clearCookie('sessionToken', {
        httpOnly: true,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'strict',
        path: '/'
      });

      const response: LogoutResponse = {
        success: true,
        message: 'Logout successful'
      };

      res.json(response);

    } catch (error) {
      logger.error(`Logout error: ${error}`);
      const response: LogoutResponse = {
        success: false,
        message: 'Internal server error'
      };
      res.status(500).json(response);
    }
  });

  /**
   * GET /api/auth/session - Get current session information
   */
  router.get('/session', (req: Request, res: Response) => {
    try {
      const sessionToken = req.cookies?.sessionToken;

      if (!sessionToken) {
        const response: SessionResponse = {
          authenticated: false
        };
        return res.json(response);
      }

      const session = sessionService.validateSession(sessionToken);
      if (!session) {
        // Clear invalid session cookie
        res.clearCookie('sessionToken', {
          httpOnly: true,
          secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
          sameSite: 'strict',
          path: '/'
        });

        const response: SessionResponse = {
          authenticated: false
        };
        return res.json(response);
      }

      const response: SessionResponse = {
        authenticated: true,
        user: {
          username: session.username,
          role: session.role
        }
      };

      res.json(response);

    } catch (error) {
      logger.error(`Session check error: ${error}`);
      const response: SessionResponse = {
        authenticated: false
      };
      res.status(500).json(response);
    }
  });

  return {
    router,
    /**
     * Sets the user service instance
     * @param service - User service instance
     */
    setUserService: (service: UserService) => {
      userService = service;
    },
    /**
     * Sets the session service instance
     * @param service - Session service instance
     */
    setSessionService: (service: SessionService) => {
      sessionService = service;
    }
  };
};