#!/usr/bin/env node

// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Command, Option } from 'commander';
import { startFastifyServer } from './server';
import {
  name as packageName,
  version,
  description,
  git_commit_hash,
} from './generated/packageMetadata';
import { createConsoleLogger } from './logger';
import {
  ServerConfig,
  LogLevel,
  AuthMode,
  DuplicatePackagePolicy,
  MissingPackageResponseMode,
} from './types';
import {
  getBaseUrlFromEnv,
  getTrustedProxiesFromEnv,
} from './utils/urlResolver';
import { runAuthInit } from './authInit';
import { runImportPackages } from './importPackages';
import { loadConfigFromPath } from './utils/configLoader';
import { dirname } from 'path';

const getPortFromEnv = (): number | undefined => {
  const port = process.env.NUGET_SERVER_PORT;
  return port ? parseInt(port, 10) : undefined;
};

const getPackageDirFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_PACKAGE_DIR;
};

const getConfigFileFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_CONFIG_FILE;
};

const getRealmFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_REALM;
};

const getLogLevelFromEnv = (): LogLevel | undefined => {
  const level = process.env.NUGET_SERVER_LOG_LEVEL;
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'ignore'];
  return validLevels.includes(level as LogLevel)
    ? (level as LogLevel)
    : undefined;
};

const getAuthModeFromEnv = (): AuthMode | undefined => {
  const authMode = process.env.NUGET_SERVER_AUTH_MODE;
  if (authMode === 'publish' || authMode === 'full' || authMode === 'none') {
    return authMode;
  }
  return undefined;
};

const getSessionSecretFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_SESSION_SECRET;
};

const getPasswordMinScoreFromEnv = (): number | undefined => {
  const value = process.env.NUGET_SERVER_PASSWORD_MIN_SCORE;
  if (value) {
    const score = parseInt(value, 10);
    if (!isNaN(score) && score >= 0 && score <= 4) {
      return score;
    }
  }
  return undefined;
};

const getPasswordStrengthCheckFromEnv = (): boolean | undefined => {
  const value = process.env.NUGET_SERVER_PASSWORD_STRENGTH_CHECK;
  if (value) {
    return value.toLowerCase() !== 'false';
  }
  return undefined;
};

const getUsersFileFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_USERS_FILE;
};

const getDuplicatePackagePolicyFromEnv = ():
  | DuplicatePackagePolicy
  | undefined => {
  const policy = process.env.NUGET_SERVER_DUPLICATE_PACKAGE_POLICY;
  if (policy === 'overwrite' || policy === 'ignore' || policy === 'error') {
    return policy;
  }
  return undefined;
};

const getMaxUploadSizeMbFromEnv = (): number | undefined => {
  const value = process.env.NUGET_SERVER_MAX_UPLOAD_SIZE_MB;
  if (value) {
    const size = parseInt(value, 10);
    if (!isNaN(size) && size >= 1 && size <= 10000) {
      return size;
    }
  }
  return undefined;
};

const getMissingPackageResponseFromEnv = ():
  | MissingPackageResponseMode
  | undefined => {
  const mode = process.env.NUGET_SERVER_MISSING_PACKAGE_RESPONSE;
  if (mode === 'empty-array' || mode === 'not-found') {
    return mode;
  }
  return undefined;
};

/////////////////////////////////////////////////////////////////////////

const program = new Command();

program
  .name(packageName)
  .summary(description)
  .addHelpText('beforeAll', `${description}\n`)
  .version(`${version}-${git_commit_hash}`)
  .addOption(new Option('-p, --port <port>', 'port number'))
  .addOption(
    new Option(
      '-b, --base-url <url>',
      'fixed base URL for API endpoints (overrides auto-detection)'
    )
  )
  .addOption(new Option('-d, --package-dir <dir>', 'package storage directory'))
  .addOption(new Option('-c, --config-file <path>', 'path to config.json file'))
  .addOption(new Option('-u, --users-file <path>', 'path to users.json file'))
  .addOption(new Option('-r, --realm <realm>', `authentication realm`))
  .addOption(
    new Option('-l, --log-level <level>', 'log level').choices([
      'debug',
      'info',
      'warn',
      'error',
      'ignore',
    ])
  )
  .addOption(
    new Option(
      '--trusted-proxies <ips>',
      'comma-separated list of trusted proxy IPs'
    )
  )
  .addOption(
    new Option('--auth-mode <mode>', 'authentication mode').choices([
      'none',
      'publish',
      'full',
    ])
  )
  .addOption(
    new Option(
      '--max-upload-size-mb <size>',
      'maximum package upload size in MB (1-10000)'
    )
  )
  .addOption(
    new Option(
      '--missing-package-response <mode>',
      'response mode for missing packages'
    ).choices(['empty-array', 'not-found'])
  )
  .addOption(
    new Option(
      '--auth-init',
      'initialize authentication with interactive admin user creation'
    )
  )
  .addOption(
    new Option(
      '--import-packages',
      'import packages from another NuGet server interactively'
    )
  )
  .action(async (options) => {
    // Determine config file path
    const configFilePath =
      options.configFile || getConfigFileFromEnv() || './config.json';

    // Create temporary logger for config loading
    const tempLogger = createConsoleLogger(packageName, 'warn');

    // Load config.json
    const configFile = await loadConfigFromPath(configFilePath, tempLogger);

    // Extract config directory from config file path for backward compatibility
    const configDir = dirname(configFilePath);

    // Determine values with proper priority: CLI > ENV > config.json > default
    const port =
      options.port !== undefined
        ? parseInt(options.port, 10)
        : getPortFromEnv() || configFile.port || 5963;

    const baseUrl =
      options.baseUrl || getBaseUrlFromEnv() || configFile.baseUrl;
    const packageDir =
      options.packageDir ||
      getPackageDirFromEnv() ||
      configFile.packageDir ||
      './packages';
    const realm =
      options.realm ||
      getRealmFromEnv() ||
      configFile.realm ||
      `${packageName} ${version}`;
    const logLevel =
      options.logLevel || getLogLevelFromEnv() || configFile.logLevel || 'info';
    const trustedProxies = options.trustedProxies
      ? options.trustedProxies.split(',').map((ip: string) => ip.trim())
      : getTrustedProxiesFromEnv() || configFile.trustedProxies;
    const authMode =
      options.authMode || getAuthModeFromEnv() || configFile.authMode || 'none';
    const sessionSecret = getSessionSecretFromEnv() || configFile.sessionSecret;
    const passwordMinScore =
      getPasswordMinScoreFromEnv() ?? configFile.passwordMinScore ?? 2;
    const passwordStrengthCheck =
      getPasswordStrengthCheckFromEnv() ??
      configFile.passwordStrengthCheck ??
      true;
    const usersFile =
      options.usersFile || getUsersFileFromEnv() || configFile.usersFile;
    const duplicatePackagePolicy =
      getDuplicatePackagePolicyFromEnv() ||
      configFile.duplicatePackagePolicy ||
      'ignore';
    const maxUploadSizeMb =
      options.maxUploadSizeMb !== undefined
        ? parseInt(options.maxUploadSizeMb, 10)
        : getMaxUploadSizeMbFromEnv() || configFile.maxUploadSizeMb || 100;
    const missingPackageResponse =
      options.missingPackageResponse ||
      getMissingPackageResponseFromEnv() ||
      configFile.missingPackageResponse ||
      'empty-array';

    // Validate log level
    const validLogLevels: LogLevel[] = [
      'debug',
      'info',
      'warn',
      'error',
      'ignore',
    ];
    if (!validLogLevels.includes(logLevel as LogLevel)) {
      console.error(
        `Invalid log level: ${logLevel}. Valid levels are: ${validLogLevels.join(', ')}`
      );
      process.exit(1);
    }

    // Create the actual logger with determined log level
    const logger = createConsoleLogger(packageName, logLevel as LogLevel);

    // Validate auth mode
    const validAuthModes: AuthMode[] = ['none', 'publish', 'full'];
    if (!validAuthModes.includes(authMode as AuthMode)) {
      console.error(
        `Invalid auth mode: ${authMode}. Valid modes are: ${validAuthModes.join(', ')}`
      );
      process.exit(1);
    }

    // Validate port
    if (isNaN(port) || port <= 0 || port > 65535) {
      console.error('Invalid port number');
      process.exit(1);
    }

    // Validate maxUploadSizeMb
    if (
      isNaN(maxUploadSizeMb) ||
      maxUploadSizeMb < 1 ||
      maxUploadSizeMb > 10000
    ) {
      console.error('Invalid max upload size. Must be between 1 and 10000 MB');
      process.exit(1);
    }

    // Validate missingPackageResponse
    const validMissingPackageModes: MissingPackageResponseMode[] = [
      'empty-array',
      'not-found',
    ];
    if (
      !validMissingPackageModes.includes(
        missingPackageResponse as MissingPackageResponseMode
      )
    ) {
      console.error(
        `Invalid missing package response mode: ${missingPackageResponse}. Valid modes are: ${validMissingPackageModes.join(', ')}`
      );
      process.exit(1);
    }

    // Display banner
    logger.info(`${packageName} [${version}-${git_commit_hash}] Starting...`);

    // Log configuration settings
    logger.info(`Port: ${port}`);

    if (baseUrl) {
      logger.info(`Base URL: ${baseUrl} (fixed)`);
    } else {
      logger.info(`Base URL: http://localhost:${port} (auto-detected)`);
    }

    logger.info(`Package directory: ${packageDir}`);
    logger.info(`Config file: ${configFilePath}`);
    if (usersFile) {
      logger.info(`Users file: ${usersFile}`);
    }
    logger.info(`Realm: ${realm}`);
    logger.info(`Authentication mode: ${authMode}`);
    logger.info(`Log level: ${logLevel}`);
    logger.info(`Max upload size: ${maxUploadSizeMb}MB`);
    logger.info(`Missing package response: ${missingPackageResponse}`);
    if (trustedProxies && trustedProxies.length > 0) {
      logger.info(`Trusted proxies: ${trustedProxies.join(', ')}`);
    }
    if (configFile && Object.keys(configFile).length > 0) {
      logger.info(`Configuration loaded from ${configFilePath}`);
    }

    const config: ServerConfig = {
      port,
      baseUrl,
      packageDir,
      configDir,
      usersFile,
      realm,
      authMode: authMode as AuthMode,
      trustedProxies,
      logLevel: logLevel as LogLevel,
      sessionSecret,
      passwordMinScore,
      passwordStrengthCheck,
      duplicatePackagePolicy: duplicatePackagePolicy as DuplicatePackagePolicy,
      maxUploadSizeMb,
      missingPackageResponse:
        missingPackageResponse as MissingPackageResponseMode,
    };

    // Handle auth-init mode
    if (options.authInit) {
      await runAuthInit(config, logger);
      process.exit(0); // Exit after initialization
    }

    // Handle import-packages mode
    if (options.importPackages) {
      await runImportPackages(config, logger);
      process.exit(0); // Exit after import
    }

    try {
      logger.info('Starting Fastify server...');
      const server = await startFastifyServer(config, logger);

      // Handle graceful shutdown
      const gracefulShutdown = async () => {
        logger.info('Shutting down server...');
        try {
          await server.close();
          process.exit(0);
        } catch (error) {
          logger.error(`Error during shutdown: ${error}`);
          process.exit(1);
        }
      };

      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);
    } catch (error) {
      logger.error(`Failed to start server: ${error}`);
      process.exit(1);
    }
  });

program.parse();
