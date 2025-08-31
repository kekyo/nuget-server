#!/usr/bin/env node

// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Command } from "commander";
import { startFastifyServer } from "./server";
import {
  name as packageName,
  version,
  description,
  git_commit_hash,
} from "./generated/packageMetadata";
import { createConsoleLogger } from "./logger";
import { ServerConfig, LogLevel, AuthMode } from "./types";
import {
  getBaseUrlFromEnv,
  getTrustedProxiesFromEnv,
} from "./utils/urlResolver";
import { runAuthInit } from "./authInit";
import { runImportPackages } from "./importPackages";
import { loadConfigFromFile } from "./utils/configLoader";

const getPortFromEnv = (): number | undefined => {
  const port = process.env.NUGET_SERVER_PORT;
  return port ? parseInt(port, 10) : undefined;
};

const getPackageDirFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_PACKAGE_DIR;
};

const getConfigDirFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_CONFIG_DIR;
};

const getRealmFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_REALM;
};

const getLogLevelFromEnv = (): LogLevel | undefined => {
  const level = process.env.NUGET_SERVER_LOG_LEVEL;
  const validLevels: LogLevel[] = ["debug", "info", "warn", "error", "ignore"];
  return validLevels.includes(level as LogLevel)
    ? (level as LogLevel)
    : undefined;
};

const getAuthModeFromEnv = (): AuthMode | undefined => {
  const authMode = process.env.NUGET_SERVER_AUTH_MODE;
  if (authMode === "publish" || authMode === "full" || authMode === "none") {
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
    return value.toLowerCase() !== "false";
  }
  return undefined;
};

const getUsersFileFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_USERS_FILE;
};

/////////////////////////////////////////////////////////////////////////

const program = new Command();

program
  .name(packageName)
  .description(description)
  .version(`${version}-${git_commit_hash}`)
  .option("-p, --port <port>", "port number")
  .option(
    "-b, --base-url <url>",
    "fixed base URL for API endpoints (overrides auto-detection)",
  )
  .option("-d, --package-dir <dir>", "package storage directory")
  .option("-c, --config-dir <dir>", "configuration directory")
  .option("-u, --users-file <path>", "path to users.json file")
  .option("-r, --realm <realm>", `authentication realm`)
  .option(
    "-l, --log-level <level>",
    "log level (debug, info, warn, error, ignore)",
  )
  .option(
    "--trusted-proxies <ips>",
    "comma-separated list of trusted proxy IPs",
  )
  .option("--auth-mode <mode>", "authentication mode (none, publish, full)")
  .option(
    "--auth-init",
    "initialize authentication with interactive admin user creation",
  )
  .option(
    "--import-packages",
    "import packages from another NuGet server interactively",
  )
  .action(async (options) => {
    // Determine config directory first
    const configDir = options.configDir || getConfigDirFromEnv() || "./";

    // Create temporary logger for config loading
    const tempLogger = createConsoleLogger(packageName, "warn");

    // Load config.json
    const configFile = await loadConfigFromFile(configDir, tempLogger);

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
      "./packages";
    const realm =
      options.realm ||
      getRealmFromEnv() ||
      configFile.realm ||
      `${packageName} ${version}`;
    const logLevel =
      options.logLevel || getLogLevelFromEnv() || configFile.logLevel || "info";
    const trustedProxies = options.trustedProxies
      ? options.trustedProxies.split(",").map((ip: string) => ip.trim())
      : getTrustedProxiesFromEnv() || configFile.trustedProxies;
    const authMode =
      options.authMode || getAuthModeFromEnv() || configFile.authMode || "none";
    const sessionSecret = getSessionSecretFromEnv() || configFile.sessionSecret;
    const passwordMinScore =
      getPasswordMinScoreFromEnv() ?? configFile.passwordMinScore ?? 2;
    const passwordStrengthCheck =
      getPasswordStrengthCheckFromEnv() ??
      configFile.passwordStrengthCheck ??
      true;
    const usersFile =
      options.usersFile || getUsersFileFromEnv() || configFile.usersFile;

    // Validate log level
    const validLogLevels: LogLevel[] = [
      "debug",
      "info",
      "warn",
      "error",
      "ignore",
    ];
    if (!validLogLevels.includes(logLevel as LogLevel)) {
      console.error(
        `Invalid log level: ${logLevel}. Valid levels are: ${validLogLevels.join(", ")}`,
      );
      process.exit(1);
    }

    // Create the actual logger with determined log level
    const logger = createConsoleLogger(packageName, logLevel as LogLevel);

    // Validate auth mode
    const validAuthModes: AuthMode[] = ["none", "publish", "full"];
    if (!validAuthModes.includes(authMode as AuthMode)) {
      console.error(
        `Invalid auth mode: ${authMode}. Valid modes are: ${validAuthModes.join(", ")}`,
      );
      process.exit(1);
    }

    // Validate port
    if (isNaN(port) || port <= 0 || port > 65535) {
      console.error("Invalid port number");
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
    logger.info(`Config directory: ${configDir}`);
    if (usersFile) {
      logger.info(`Users file: ${usersFile}`);
    }
    logger.info(`Realm: ${realm}`);
    logger.info(`Authentication mode: ${authMode}`);
    logger.info(`Log level: ${logLevel}`);
    if (trustedProxies && trustedProxies.length > 0) {
      logger.info(`Trusted proxies: ${trustedProxies.join(", ")}`);
    }
    if (configFile && Object.keys(configFile).length > 0) {
      logger.info(`Loaded configuration from ${configDir}/config.json`);
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
      logger.info("Starting Fastify server...");
      const server = await startFastifyServer(config, logger);

      // Handle graceful shutdown
      const gracefulShutdown = async () => {
        logger.info("Shutting down server...");
        try {
          await server.close();
          process.exit(0);
        } catch (error) {
          logger.error(`Error during shutdown: ${error}`);
          process.exit(1);
        }
      };

      process.on("SIGTERM", gracefulShutdown);
      process.on("SIGINT", gracefulShutdown);
    } catch (error) {
      logger.error(`Failed to start server: ${error}`);
      process.exit(1);
    }
  });

program.parse();
