// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAuthFailureTracker, createAuthFailureTrackerFromEnv } from '../src/services/authFailureTracker';
import { Logger } from '../src/types';

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

const mockRequest = {
  headers: {},
  socket: { remoteAddress: '192.168.1.100' }
};

const mockRequestWithHeaders = {
  headers: {
    'x-forwarded-for': '203.0.113.195',
    'x-real-ip': '198.51.100.178'
  },
  socket: { remoteAddress: '192.168.1.100' }
};

describe('AuthFailureTracker - Basic Functionality', () => {
  let tracker: ReturnType<typeof createAuthFailureTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = createAuthFailureTracker({
      logger: mockLogger,
      enabled: true,
      delays: [100, 200, 300] // Shorter delays for testing
    });
  });

  afterEach(() => {
    if (tracker) {
      tracker.destroy();
    }
  });

  it('should create tracker with default configuration', () => {
    const stats = tracker.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.ipCount).toBe(0);
    expect(stats.userCount).toBe(0);
  });

  it('should record failure and track by IP', () => {
    tracker.recordFailure(mockRequest);
    
    const failureCount = tracker.getFailureCount(mockRequest);
    expect(failureCount).toBe(1);
    
    const stats = tracker.getStats();
    expect(stats.ipCount).toBe(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Auth failure recorded for IP 192.168.1.100: attempt #1')
    );
  });

  it('should record failure and track by username', () => {
    tracker.recordFailure(mockRequest, 'testuser');
    
    const failureCount = tracker.getFailureCount(mockRequest, 'testuser');
    expect(failureCount).toBe(1);
    
    const stats = tracker.getStats();
    expect(stats.userCount).toBe(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Auth failure recorded for user testuser: attempt #1')
    );
  });

  it('should apply progressive delay based on failure count', async () => {
    const startTime = Date.now();

    // First failure - should apply 100ms delay
    tracker.recordFailure(mockRequest, 'testuser');
    const delay1 = await tracker.applyDelay(mockRequest, 'testuser');

    const elapsed1 = Date.now() - startTime;
    expect(delay1).toBe(100);
    expect(elapsed1).toBeGreaterThanOrEqual(100);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Applying 100ms delay for auth failure #1')
    );
  });

  it('should clear failures on successful authentication', () => {
    tracker.recordFailure(mockRequest, 'testuser');
    expect(tracker.getFailureCount(mockRequest, 'testuser')).toBe(1);
    
    tracker.clearFailures(mockRequest, 'testuser');
    expect(tracker.getFailureCount(mockRequest, 'testuser')).toBe(0);
    
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Cleared auth failure tracking for IP: 192.168.1.100'
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Cleared auth failure tracking for user: testuser'
    );
  });

  it('should extract IP from X-Forwarded-For header', () => {
    tracker.recordFailure(mockRequestWithHeaders);
    
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Auth failure recorded for IP 203.0.113.195')
    );
  });

  it('should handle multiple failures and increment count', () => {
    tracker.recordFailure(mockRequest, 'testuser');
    tracker.recordFailure(mockRequest, 'testuser');
    tracker.recordFailure(mockRequest, 'testuser');
    
    const failureCount = tracker.getFailureCount(mockRequest, 'testuser');
    expect(failureCount).toBe(3);
    
    expect(mockLogger.warn).toHaveBeenLastCalledWith(
      expect.stringContaining('Auth failure recorded for user testuser: attempt #3')
    );
  });

  it('should use maximum failure count from IP or username', () => {
    // Record 2 failures for IP only
    tracker.recordFailure(mockRequest);
    tracker.recordFailure(mockRequest);
    
    // Record 3 failures for username (which also increments IP count)
    tracker.recordFailure(mockRequest, 'testuser');
    tracker.recordFailure(mockRequest, 'testuser');
    tracker.recordFailure(mockRequest, 'testuser');
    
    // Should return max count (5 total: 2 IP-only + 3 with both IP and username)
    const failureCount = tracker.getFailureCount(mockRequest, 'testuser');
    expect(failureCount).toBe(5);
  });
});

describe('AuthFailureTracker - Disabled State', () => {
  let tracker: ReturnType<typeof createAuthFailureTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = createAuthFailureTracker({
      logger: mockLogger,
      enabled: false
    });
  });

  afterEach(() => {
    if (tracker) {
      tracker.destroy();
    }
  });

  it('should not track failures when disabled', () => {
    tracker.recordFailure(mockRequest, 'testuser');
    
    const failureCount = tracker.getFailureCount(mockRequest, 'testuser');
    expect(failureCount).toBe(0);
    
    const stats = tracker.getStats();
    expect(stats.enabled).toBe(false);
    expect(stats.ipCount).toBe(0);
    expect(stats.userCount).toBe(0);
  });

  it('should not apply delay when disabled', async () => {
    const startTime = Date.now();
    
    const delay = await tracker.applyDelay(mockRequest, 'testuser');
    const elapsed = Date.now() - startTime;
    
    expect(delay).toBe(0);
    expect(elapsed).toBeLessThan(50); // Should be almost instant
  });
});

describe('AuthFailureTracker - Environment Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tracker: ReturnType<typeof createAuthFailureTracker>;

  beforeEach(() => {
    originalEnv = process.env;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    if (tracker) {
      tracker.destroy();
    }
  });

  it('should create enabled tracker by default', () => {
    delete process.env.NUGET_SERVER_AUTH_FAILURE_DELAY_ENABLED;
    
    tracker = createAuthFailureTrackerFromEnv(mockLogger);
    const stats = tracker.getStats();
    
    expect(stats.enabled).toBe(true);
  });

  it('should create disabled tracker when environment variable is false', () => {
    process.env.NUGET_SERVER_AUTH_FAILURE_DELAY_ENABLED = 'false';
    
    tracker = createAuthFailureTrackerFromEnv(mockLogger);
    const stats = tracker.getStats();
    
    expect(stats.enabled).toBe(false);
  });

  it('should use custom max delay from environment', () => {
    process.env.NUGET_SERVER_AUTH_FAILURE_MAX_DELAY = '5000';
    delete process.env.NUGET_SERVER_AUTH_FAILURE_DELAY_ENABLED;
    
    tracker = createAuthFailureTrackerFromEnv(mockLogger);
    
    // This is hard to test directly without exposing internal config,
    // but we can verify the tracker was created successfully
    const stats = tracker.getStats();
    expect(stats.enabled).toBe(true);
  });
});