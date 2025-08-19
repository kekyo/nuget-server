#!/usr/bin/env node

// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Command } from 'commander';
import { startServer } from './server';
import { name as packageName, version, description, git_commit_hash } from './generated/packageMetadata';
import { createConsoleLogger } from './logger';
import { ServerConfig } from './types';
import { getBaseUrlFromEnv, getTrustedProxiesFromEnv } from './utils/urlResolver';

const getConfigDirFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_CONFIG_DIR;
};

const program = new Command();
const logger = createConsoleLogger(packageName);

program.
  name(`${packageName} [${version}-${git_commit_hash}]`).
  description(description).
  version(version).
  option('-p, --port <port>', 'port number', '5963').
  option('-b, --base-url <url>', 'fixed base URL for API endpoints (overrides auto-detection)').
  option('-d, --package-dir <dir>', 'package storage directory', './packages').
  option('-c, --config-dir <dir>', 'configuration directory for authentication files', './').
  option('--trusted-proxies <ips>', 'comma-separated list of trusted proxy IPs').
  action(async (options) => {
    const port = parseInt(options.port, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      logger.error('Invalid port number');
      process.exit(1);
    }

    const baseUrl = options.baseUrl || getBaseUrlFromEnv();
    const configDir = options.configDir || getConfigDirFromEnv() || './';
    const trustedProxies = options.trustedProxies 
      ? options.trustedProxies.split(',').map((ip: string) => ip.trim())
      : getTrustedProxiesFromEnv();

    const config: ServerConfig = {
      port,
      baseUrl,
      packageDir: options.packageDir,
      configDir,
      trustedProxies
    };
    
    try {
      const serverInstance = await startServer(config, logger);
      // Server is now running, CLI keeps process alive
    } catch (error) {
      logger.error(`Failed to start server: ${error}`);
      process.exit(1);
    }
  });

program.parse();
