import fs from 'fs-extra';
import path from 'path';
import dayjs from 'dayjs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LogLevel } from '../../src/types';

const execAsync = promisify(exec);

// Test global log level string
export const testGlobalLogLevel = process.env['NUGET_SERVER_TEST_LOGLEVEL'] as (LogLevel | undefined) ?? 'warn';

// Timestamp for test directories
const timestamp = dayjs().format('YYYYMMDD_HHmmss');

/**
 * Creates a test directory with timestamp for test isolation
 */
export const createTestDirectory = async (categoryName: string, testName: string): Promise<string> => {
  // Sanitize names to be filesystem-safe
  const sanitize = (name: string) => name
    .replaceAll(' ', '-')
    .replaceAll('/', '_')     // Replace slash with underscore
    .replaceAll('\\', '_')    // Replace backslash
    .replaceAll(':', '_')     // Replace colon
    .replaceAll('*', '_')     // Replace asterisk
    .replaceAll('?', '_')     // Replace question mark
    .replaceAll('"', '_')     // Replace double quote
    .replaceAll('<', '_')     // Replace less than
    .replaceAll('>', '_')     // Replace greater than
    .replaceAll('|', '_');    // Replace pipe
  
  const testDir = path.join(
    process.cwd(), 
    'test-results', 
    timestamp, 
    sanitize(categoryName), 
    sanitize(testName)
  );
  await fs.ensureDir(testDir);
  return testDir;
}

// Port counter for sequential uniqueness
let portCounter = 0;

/**
 * Generates a test port number to avoid conflicts
 * Ensures ports stay within valid range and don't conflict
 */
export const getTestPort = (basePort: number = 6000): number => {
  // Simple incremental approach with wrap-around
  // This ensures unique ports for each test within a test run
  const offset = portCounter++ % 9000; // Use range of 9000 ports
  const port = basePort + offset;
  
  // Additional safety check
  if (port > 65535) {
    portCounter = 0; // Reset counter
    return basePort;
  }
  
  return port;
}

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
}