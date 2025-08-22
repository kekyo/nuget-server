#!/usr/bin/env node

// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Command } from 'commander';
import { startServer } from './server';
import { name as packageName, version, description, git_commit_hash } from './generated/packageMetadata';
import { createConsoleLogger } from './logger';
import { ServerConfig, LogLevel, AuthMode } from './types';
import { getBaseUrlFromEnv, getTrustedProxiesFromEnv } from './utils/urlResolver';

const getConfigDirFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_CONFIG_DIR;
};

const getRealmFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_REALM;
};

const getAuthModeFromEnv = (): AuthMode | undefined => {
  const authMode = process.env.NUGET_SERVER_ENABLE_AUTH;
  if (authMode === 'publish' || authMode === 'full' || authMode === 'none') {
    return authMode;
  }
  return undefined;
};

const program = new Command();

program.
  name(`${packageName} [${version}-${git_commit_hash}]`).
  description(description).
  version(version).
  option('-p, --port <port>', 'port number', '5963').
  option('-b, --base-url <url>', 'fixed base URL for API endpoints (overrides auto-detection)').
  option('-d, --package-dir <dir>', 'package storage directory', './packages').
  option('-c, --config-dir <dir>', 'configuration directory for authentication files', './').
  option('-r, --realm <realm>', `authentication realm (default: "${packageName} ${version}")`, `${packageName} ${version}`).
  option('-l, --log <level>', 'log level (debug, info, warn, error, ignore)', 'info').
  option('--no-ui', 'disable UI serving').
  option('--trusted-proxies <ips>', 'comma-separated list of trusted proxy IPs').
  option('--enable-auth <mode>', 'authentication mode (none, publish, full)').
  action(async (options) => {
    // Validate log level
    const validLogLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'ignore'];
    if (!validLogLevels.includes(options.log as LogLevel)) {
      console.error(`Invalid log level: ${options.log}. Valid levels are: ${validLogLevels.join(', ')}`);
      process.exit(1);
    }

    // Get auth mode from CLI option or environment variable, default to 'none'
    const authMode = (options.enableAuth || getAuthModeFromEnv() || 'none') as AuthMode;
    
    // Validate auth mode
    const validAuthModes: AuthMode[] = ['none', 'publish', 'full'];
    if (!validAuthModes.includes(authMode)) {
      console.error(`Invalid auth mode: ${authMode}. Valid modes are: ${validAuthModes.join(', ')}`);
      process.exit(1);
    }

    const logger = createConsoleLogger(packageName, options.log as LogLevel);

    // Display banner
    logger.info(`${packageName} [${version}-${git_commit_hash}] Starting...`);

    const port = parseInt(options.port, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      logger.error('Invalid port number');
      process.exit(1);
    }

    const baseUrl = options.baseUrl || getBaseUrlFromEnv();
    const configDir = options.configDir || getConfigDirFromEnv() || './';
    const realm = options.realm || getRealmFromEnv() || `${packageName} ${version}`;
    const trustedProxies = options.trustedProxies 
      ? options.trustedProxies.split(',').map((ip: string) => ip.trim())
      : getTrustedProxiesFromEnv();

    // Log configuration settings
    logger.info(`Port: ${port}`);
    
    if (baseUrl) {
      logger.info(`Base URL: ${baseUrl} (fixed)`);
    } else {
      logger.info(`Base URL: http://localhost:${port} (auto-detected)`);
    }
    
    logger.info(`Package directory: ${options.packageDir}`);
    logger.info(`Config directory: ${configDir}`);
    logger.info(`Realm: ${realm}`);
    logger.info(`Authentication mode: ${authMode}`);
    logger.info(`Log level: ${options.log}`);
    logger.info(`UI enabled: ${options.ui ? 'yes' : 'no'}`);
    
    if (trustedProxies && trustedProxies.length > 0) {
      logger.info(`Trusted proxies: ${trustedProxies.join(', ')}`);
    }

    const config: ServerConfig = {
      port,
      baseUrl,
      packageDir: options.packageDir,
      configDir,
      realm,
      authMode: authMode as AuthMode,
      trustedProxies,
      logLevel: options.log as LogLevel,
      noUi: !options.ui
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
