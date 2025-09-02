// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { createTestDirectory, getTestPort } from './helpers/test-helper';
import { loadConfigFromPath } from '../src/utils/configLoader';
import { createConsoleLogger } from '../src/logger';

const execAsync = promisify(exec);

describe('Max Upload Size Configuration - Config file validation', () => {
  let testDir: string;
  let testPort: number;
  const cliPath = join(process.cwd(), 'dist', 'cli.js');

  beforeEach(async (fn) => {
    testDir = await createTestDirectory('max-upload-size', fn.task.name);
    testPort = getTestPort(6300);
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.NUGET_SERVER_MAX_UPLOAD_SIZE_MB;
  });

  const runCli = async (
    args: string = '',
    env: Record<string, string> = {}
  ): Promise<{ stdout: string; stderr: string }> => {
    // Merge environment variables with current process env
    const fullEnv = { ...process.env, ...env };

    // Run with timeout to prevent hanging - increased to 5 seconds for slower systems
    const command = `timeout 5 node ${cliPath} ${args} || true`;
    return execAsync(command, { env: fullEnv });
  };

  it('should load maxUploadSizeMb from config.json', async () => {
    const configPath = join(testDir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        port: 5963,
        maxUploadSizeMb: 200,
      })
    );

    const config = await loadConfigFromPath(configPath);
    expect(config.maxUploadSizeMb).toBe(200);
  });

  it('should validate maxUploadSizeMb minimum value', async () => {
    const configPath = join(testDir, 'config.json');
    const logger = createConsoleLogger('test', 'ignore');

    // Test value below minimum (0)
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: 0,
      })
    );

    const config = await loadConfigFromPath(configPath, logger);
    expect(config.maxUploadSizeMb).toBeUndefined();
  });

  it('should validate maxUploadSizeMb maximum value', async () => {
    const configPath = join(testDir, 'config.json');
    const logger = createConsoleLogger('test', 'ignore');

    // Test value above maximum (10001)
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: 10001,
      })
    );

    const config = await loadConfigFromPath(configPath, logger);
    expect(config.maxUploadSizeMb).toBeUndefined();
  });

  it('should accept valid maxUploadSizeMb values', async () => {
    const configPath = join(testDir, 'config.json');

    // Test minimum valid value
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: 1,
      })
    );
    let config = await loadConfigFromPath(configPath);
    expect(config.maxUploadSizeMb).toBe(1);

    // Test maximum valid value
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: 10000,
      })
    );
    config = await loadConfigFromPath(configPath);
    expect(config.maxUploadSizeMb).toBe(10000);

    // Test typical value
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: 500,
      })
    );
    config = await loadConfigFromPath(configPath);
    expect(config.maxUploadSizeMb).toBe(500);
  });

  it('should ignore invalid maxUploadSizeMb types', async () => {
    const configPath = join(testDir, 'config.json');
    const logger = createConsoleLogger('test', 'ignore');

    // Test string value
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: '100',
      })
    );
    let config = await loadConfigFromPath(configPath, logger);
    expect(config.maxUploadSizeMb).toBeUndefined();

    // Test boolean value
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: true,
      })
    );
    config = await loadConfigFromPath(configPath, logger);
    expect(config.maxUploadSizeMb).toBeUndefined();

    // Test array value
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: [100],
      })
    );
    config = await loadConfigFromPath(configPath, logger);
    expect(config.maxUploadSizeMb).toBeUndefined();
  });
});

describe('Max Upload Size Configuration - CLI argument parsing', () => {
  let testDir: string;
  let testPort: number;
  const cliPath = join(process.cwd(), 'dist', 'cli.js');

  beforeEach(async (fn) => {
    testDir = await createTestDirectory('max-upload-size', fn.task.name);
    testPort = getTestPort(6300);
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.NUGET_SERVER_MAX_UPLOAD_SIZE_MB;
  });

  const runCli = async (
    args: string = '',
    env: Record<string, string> = {}
  ): Promise<{ stdout: string; stderr: string }> => {
    // Merge environment variables with current process env
    const fullEnv = { ...process.env, ...env };

    // Run with timeout to prevent hanging - increased to 5 seconds for slower systems
    const command = `timeout 5 node ${cliPath} ${args} || true`;
    return execAsync(command, { env: fullEnv });
  };
  it('should accept --max-upload-size-mb argument', async () => {
    const { stdout } = await runCli(
      `--port ${testPort} --max-upload-size-mb 250 --package-dir ${testDir}`
    );

    expect(stdout).toContain('Max upload size: 250MB');
  }, 10000);

  it('should reject invalid --max-upload-size-mb values', async () => {
    // Test value below minimum
    let result = await runCli(
      `--port ${testPort} --max-upload-size-mb 0 --package-dir ${testDir}`
    );
    expect(result.stderr).toContain(
      'Invalid max upload size. Must be between 1 and 10000 MB'
    );

    // Test value above maximum
    result = await runCli(
      `--port ${testPort} --max-upload-size-mb 10001 --package-dir ${testDir}`
    );
    expect(result.stderr).toContain(
      'Invalid max upload size. Must be between 1 and 10000 MB'
    );

    // Test non-numeric value
    result = await runCli(
      `--port ${testPort} --max-upload-size-mb abc --package-dir ${testDir}`
    );
    expect(result.stderr).toContain(
      'Invalid max upload size. Must be between 1 and 10000 MB'
    );
  }, 10000);

  it('should use default value when not specified', async () => {
    const { stdout } = await runCli(
      `--port ${testPort} --package-dir ${testDir}`
    );

    expect(stdout).toContain('Max upload size: 100MB');
  }, 10000);
});

describe('Max Upload Size Configuration - Environment variable parsing', () => {
  let testDir: string;
  let testPort: number;
  const cliPath = join(process.cwd(), 'dist', 'cli.js');

  beforeEach(async (fn) => {
    testDir = await createTestDirectory('max-upload-size', fn.task.name);
    testPort = getTestPort(6300);
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.NUGET_SERVER_MAX_UPLOAD_SIZE_MB;
  });

  const runCli = async (
    args: string = '',
    env: Record<string, string> = {}
  ): Promise<{ stdout: string; stderr: string }> => {
    // Merge environment variables with current process env
    const fullEnv = { ...process.env, ...env };

    // Run with timeout to prevent hanging - increased to 5 seconds for slower systems
    const command = `timeout 5 node ${cliPath} ${args} || true`;
    return execAsync(command, { env: fullEnv });
  };
  it('should accept NUGET_SERVER_MAX_UPLOAD_SIZE_MB environment variable', async () => {
    const { stdout } = await runCli(
      `--port ${testPort} --package-dir ${testDir}`,
      { NUGET_SERVER_MAX_UPLOAD_SIZE_MB: '300' }
    );

    expect(stdout).toContain('Max upload size: 300MB');
  }, 10000);

  it('should use default value for invalid environment variable values', async () => {
    // Test value below minimum - should use default
    const { stdout: stdout1 } = await runCli(
      `--port ${testPort} --package-dir ${testDir}`,
      { NUGET_SERVER_MAX_UPLOAD_SIZE_MB: '0' }
    );
    expect(stdout1).toContain('Max upload size: 100MB');
  }, 10000);

  it('should use default value for environment variable above maximum', async () => {
    // Test value above maximum - should use default
    const { stdout } = await runCli(
      `--port ${testPort + 1} --package-dir ${testDir}`,
      { NUGET_SERVER_MAX_UPLOAD_SIZE_MB: '10001' }
    );
    expect(stdout).toContain('Max upload size: 100MB');
  }, 10000);

  it('should use default value for non-numeric environment variable', async () => {
    // Test non-numeric value - should use default
    const { stdout } = await runCli(
      `--port ${testPort + 2} --package-dir ${testDir}`,
      { NUGET_SERVER_MAX_UPLOAD_SIZE_MB: 'abc' }
    );
    expect(stdout).toContain('Max upload size: 100MB');
  }, 10000);
});

describe('Max Upload Size Configuration - Configuration priority', () => {
  let testDir: string;
  let testPort: number;
  const cliPath = join(process.cwd(), 'dist', 'cli.js');

  beforeEach(async (fn) => {
    testDir = await createTestDirectory('max-upload-size', fn.task.name);
    testPort = getTestPort(6300);
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.NUGET_SERVER_MAX_UPLOAD_SIZE_MB;
  });

  const runCli = async (
    args: string = '',
    env: Record<string, string> = {}
  ): Promise<{ stdout: string; stderr: string }> => {
    // Merge environment variables with current process env
    const fullEnv = { ...process.env, ...env };

    // Run with timeout to prevent hanging - increased to 5 seconds for slower systems
    const command = `timeout 5 node ${cliPath} ${args} || true`;
    return execAsync(command, { env: fullEnv });
  };
  it('should prioritize CLI over environment and config', async () => {
    // Create config file with one value
    const configPath = join(testDir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: 150,
      })
    );

    // Run with environment variable and CLI argument
    const { stdout } = await runCli(
      `--port ${testPort} --config-file ${configPath} --max-upload-size-mb 400 --package-dir ${testDir}`,
      { NUGET_SERVER_MAX_UPLOAD_SIZE_MB: '300' }
    );

    // CLI argument (400) should win over env (300) and config (150)
    expect(stdout).toContain('Max upload size: 400MB');
  }, 10000);

  it('should prioritize environment over config when CLI not specified', async () => {
    // Create config file with one value
    const configPath = join(testDir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: 150,
      })
    );

    // Run with environment variable but no CLI argument
    const { stdout } = await runCli(
      `--port ${testPort} --config-file ${configPath} --package-dir ${testDir}`,
      { NUGET_SERVER_MAX_UPLOAD_SIZE_MB: '300' }
    );

    // Environment (300) should win over config (150)
    expect(stdout).toContain('Max upload size: 300MB');
  }, 10000);

  it('should use config value when CLI and env not specified', async () => {
    // Create config file with one value
    const configPath = join(testDir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        maxUploadSizeMb: 150,
      })
    );

    // Run without environment variable or CLI argument
    const { stdout } = await runCli(
      `--port ${testPort} --config-file ${configPath} --package-dir ${testDir}`
    );

    // Config value (150) should be used
    expect(stdout).toContain('Max upload size: 150MB');
  }, 10000);
});
