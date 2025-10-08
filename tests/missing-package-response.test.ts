// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const waitForServer = async (port: number, maxAttempts = 30): Promise<void> => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/v3/index.json`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Server failed to start within timeout');
};

describe('Missing Package Response Configuration', () => {
  let serverProcess: ChildProcess | null = null;
  let testDir: string;
  const testPort = 15963;

  beforeEach(async () => {
    // Create a test directory with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    testDir = path.join(__dirname, 'test-data', `missing-pkg-${timestamp}`);
    await fs.ensureDir(testDir);
    await fs.ensureDir(path.join(testDir, 'packages'));
  });

  afterEach(async () => {
    // Kill the server process if running
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      serverProcess = null;
    }

    // Clean up test directory
    if (testDir) {
      await fs.remove(testDir);
    }
  });

  it('should return empty array by default for missing packages', async () => {
    // Start server with default configuration
    const cliPath = path.join(__dirname, '..', 'dist', 'cli.mjs');
    serverProcess = spawn(
      'node',
      [
        cliPath,
        '--port',
        testPort.toString(),
        '--package-dir',
        path.join(testDir, 'packages'),
        '--log-level',
        'debug',
      ],
      {
        stdio: 'inherit',
        env: { ...process.env },
      }
    );

    await waitForServer(testPort);

    // Request a non-existent package
    const response = await fetch(
      `http://localhost:${testPort}/v3/package/NonExistentPackage/index.json`
    );

    // Should return 200 with empty versions array (default behavior)
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ versions: [] });
  });

  it('should return 404 when configured with not-found mode', async () => {
    // Start server with not-found mode
    const cliPath = path.join(__dirname, '..', 'dist', 'cli.mjs');
    serverProcess = spawn(
      'node',
      [
        cliPath,
        '--port',
        testPort.toString(),
        '--package-dir',
        path.join(testDir, 'packages'),
        '--log-level',
        'debug',
        '--missing-package-response',
        'not-found',
      ],
      {
        stdio: 'inherit',
        env: { ...process.env },
      }
    );

    await waitForServer(testPort);

    // Request a non-existent package
    const response = await fetch(
      `http://localhost:${testPort}/v3/package/NonExistentPackage/index.json`
    );

    // Should return 404
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  it('should respect environment variable configuration', async () => {
    // Start server with environment variable set to not-found
    const cliPath = path.join(__dirname, '..', 'dist', 'cli.mjs');
    serverProcess = spawn(
      'node',
      [
        cliPath,
        '--port',
        testPort.toString(),
        '--package-dir',
        path.join(testDir, 'packages'),
        '--log-level',
        'debug',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          NUGET_SERVER_MISSING_PACKAGE_RESPONSE: 'not-found',
        },
      }
    );

    await waitForServer(testPort);

    // Request a non-existent package
    const response = await fetch(
      `http://localhost:${testPort}/v3/package/NonExistentPackage/index.json`
    );

    // Should return 404 based on environment variable
    expect(response.status).toBe(404);
  });

  it('should prioritize CLI argument over environment variable', async () => {
    // Start server with conflicting CLI and env settings
    const cliPath = path.join(__dirname, '..', 'dist', 'cli.mjs');
    serverProcess = spawn(
      'node',
      [
        cliPath,
        '--port',
        testPort.toString(),
        '--package-dir',
        path.join(testDir, 'packages'),
        '--log-level',
        'debug',
        '--missing-package-response',
        'empty-array',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          NUGET_SERVER_MISSING_PACKAGE_RESPONSE: 'not-found',
        },
      }
    );

    await waitForServer(testPort);

    // Request a non-existent package
    const response = await fetch(
      `http://localhost:${testPort}/v3/package/NonExistentPackage/index.json`
    );

    // Should return 200 based on CLI argument (overrides env)
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ versions: [] });
  });
});
