// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { createBasicAuthMiddleware, createOptionalBasicAuthMiddleware } from '../src/middleware/basicAuth';
import { HtpasswdUser } from '../src/utils/htpasswd';
import { Logger } from '../src/types';

// Mock logger
const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

// Helper to create mock request
const createMockRequest = (authHeader?: string): Request => ({
  headers: {
    authorization: authHeader
  }
} as Request);

// Helper to create mock response
const createMockResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis()
  } as unknown as Response;
  
  return res;
};

// Helper to create user map
const createUserMap = (users: Array<{ username: string; password: string; hashType: HtpasswdUser['hashType'] }>) => {
  const userMap = new Map<string, HtpasswdUser>();
  
  for (const user of users) {
    userMap.set(user.username, {
      username: user.username,
      passwordHash: user.password,
      hashType: user.hashType
    });
  }
  
  return userMap;
};

describe('Basic Auth Middleware', () => {
  describe('createBasicAuthMiddleware', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const users = createUserMap([]);
      const middleware = createBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.set).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="NuGet Server"');
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        message: 'Please provide valid credentials'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header is not Basic', async () => {
      const users = createUserMap([]);
      const middleware = createBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      const req = createMockRequest('Bearer token123');
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when credentials format is invalid', async () => {
      const users = createUserMap([]);
      const middleware = createBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      // Base64 of "invalid-format" (no colon)
      const invalidCreds = Buffer.from('invalid-format').toString('base64');
      const req = createMockRequest(`Basic ${invalidCreds}`);
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockLogger.warn).toHaveBeenCalledWith('Basic auth: Invalid credentials format');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when username or password is empty', async () => {
      const users = createUserMap([]);
      const middleware = createBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      // Base64 of "user:" (empty password)
      const emptyCreds = Buffer.from('user:').toString('base64');
      const req = createMockRequest(`Basic ${emptyCreds}`);
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*\] Basic auth: Empty username or password$/)
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not found', async () => {
      const users = createUserMap([
        { username: 'admin', password: 'adminpass', hashType: 'plain' }
      ]);
      const middleware = createBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      // Base64 of "user:password"
      const credentials = Buffer.from('user:password').toString('base64');
      const req = createMockRequest(`Basic ${credentials}`);
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*\] Basic auth: User not found: user \(available users: admin\)$/)
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when password is incorrect', async () => {
      const users = createUserMap([
        { username: 'admin', password: 'adminpass', hashType: 'plain' }
      ]);
      const middleware = createBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      // Base64 of "admin:wrongpass"
      const credentials = Buffer.from('admin:wrongpass').toString('base64');
      const req = createMockRequest(`Basic ${credentials}`);
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*\] Basic auth: Invalid password for user: admin$/)
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() when authentication is successful', async () => {
      const users = createUserMap([
        { username: 'admin', password: 'adminpass', hashType: 'plain' }
      ]);
      const middleware = createBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      // Base64 of "admin:adminpass"
      const credentials = Buffer.from('admin:adminpass').toString('base64');
      const req = createMockRequest(`Basic ${credentials}`) as any;
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual({ username: 'admin' });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*\] Basic auth: Successfully authenticated user: admin$/)
      );
    });

    it('should use custom realm', async () => {
      const users = createUserMap([]);
      const middleware = createBasicAuthMiddleware({
        realm: 'Custom Realm',
        users,
        logger: mockLogger
      });
      
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(res.set).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Custom Realm"');
    });
  });

  describe('createOptionalBasicAuthMiddleware', () => {
    it('should skip authentication when no users are configured', async () => {
      const users = new Map<string, HtpasswdUser>();
      const middleware = createOptionalBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      const req = createMockRequest(); // No auth header
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should apply authentication when users are configured', async () => {
      const users = createUserMap([
        { username: 'admin', password: 'adminpass', hashType: 'plain' }
      ]);
      const middleware = createOptionalBasicAuthMiddleware({
        users,
        logger: mockLogger
      });
      
      const req = createMockRequest(); // No auth header
      const res = createMockResponse();
      const next = vi.fn();
      
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});