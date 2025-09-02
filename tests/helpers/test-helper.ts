import path from 'path';
import dayjs from 'dayjs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LogLevel } from '../../src/types';
import { ensureDir } from './fs-utils';

const execAsync = promisify(exec);

// Test global log level string
export const testGlobalLogLevel =
  (process.env['NUGET_SERVER_TEST_LOGLEVEL'] as LogLevel | undefined) ?? 'warn';

// Timestamp for test directories
const timestamp = dayjs().format('YYYYMMDD_HHmmss');

/**
 * Creates a test directory with timestamp for test isolation
 */
export const createTestDirectory = async (
  categoryName: string,
  testName: string
): Promise<string> => {
  // Sanitize names to be filesystem-safe
  const sanitize = (name: string) =>
    name
      .replaceAll(' ', '-')
      .replaceAll('/', '_') // Replace slash with underscore
      .replaceAll('\\', '_') // Replace backslash
      .replaceAll(':', '_') // Replace colon
      .replaceAll('*', '_') // Replace asterisk
      .replaceAll('?', '_') // Replace question mark
      .replaceAll('"', '_') // Replace double quote
      .replaceAll('<', '_') // Replace less than
      .replaceAll('>', '_') // Replace greater than
      .replaceAll('|', '_'); // Replace pipe

  const testDir = path.join(
    process.cwd(),
    'test-results',
    timestamp,
    sanitize(categoryName),
    sanitize(testName)
  );
  await ensureDir(testDir);
  return testDir;
};

/**
 * Generates a test port number to avoid conflicts
 * Uses process.pid and random component for better uniqueness across parallel test runs
 */
export const getTestPort = (basePort: number = 6000): number => {
  // Use process.pid for better uniqueness across parallel test runs
  const pidComponent = process.pid % 1000;
  const randomComponent = Math.floor(Math.random() * 4000); // 0-3999
  const port = basePort + pidComponent + randomComponent;

  // Ensure port stays within valid range
  if (port > 65535) {
    // Fall back to basePort with smaller random offset
    return basePort + Math.floor(Math.random() * 1000);
  }

  return port;
};

/**
 * Forcefully terminates any remaining CLI processes
 * Used in test cleanup to prevent zombie processes
 */
export const cleanupCLIProcesses = async (): Promise<void> => {
  try {
    // Use shell command with proper error suppression
    // pkill returns 1 when no processes are found, which is normal
    await execAsync('pkill -f "dist/cli" 2>/dev/null || true');
  } catch (error) {
    // Silently ignore all errors - this is expected when no processes exist
  }
};

/**
 * Waits for the NuGet server to be ready by polling the V3 service index
 * @param serverPort - The port where the server is running
 * @param authMode - The authentication mode ('none', 'publish', or 'full')
 * @param maxRetries - Maximum number of retry attempts (default: 30)
 * @param retryDelay - Delay between retries in milliseconds (default: 500)
 * @returns Promise that resolves when the server is ready
 * @throws Error if the server doesn't become ready within the timeout
 */
export const waitForServerReady = async (
  serverPort: number,
  authMode: 'none' | 'publish' | 'full',
  maxRetries: number = 30,
  retryDelay: number = 500
): Promise<void> => {
  const url = `http://localhost:${serverPort}/v3/index.json`;

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Set a short timeout to avoid blocking
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(url, {
        signal: controller.signal,
        // Avoid following redirects that might hang
        redirect: 'manual',
      });

      clearTimeout(timeoutId);

      // Check expected status based on auth mode
      if (authMode === 'none' || authMode === 'publish') {
        // These modes should allow anonymous access to V3 API
        if (response.status === 200) {
          return; // Server is ready
        }
      } else if (authMode === 'full') {
        // Full auth mode should return 401 for unauthorized access
        if (response.status === 401) {
          return; // Server is ready (and properly rejecting unauthorized requests)
        }
      }

      // Unexpected status, continue retrying
      if (i === maxRetries - 1) {
        throw new Error(
          `Server returned unexpected status ${response.status} for authMode=${authMode}`
        );
      }
    } catch (error: any) {
      // Handle fetch errors (connection refused, timeout, etc.)
      if (i === maxRetries - 1) {
        // Last attempt failed
        throw new Error(
          `Server failed to start within ${(maxRetries * retryDelay) / 1000} seconds: ${error.message}`
        );
      }

      // Server not ready yet, continue retrying
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
};
