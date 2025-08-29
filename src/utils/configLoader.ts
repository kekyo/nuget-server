// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { LogLevel, AuthMode, Logger } from "../types";

/**
 * Configuration file structure for nuget-server
 */
export interface ConfigFile {
  port?: number;
  baseUrl?: string;
  packageDir?: string;
  realm?: string;
  logLevel?: LogLevel;
  trustedProxies?: string[];
  authMode?: AuthMode;
  sessionSecret?: string;
  passwordMinScore?: number;
  passwordStrengthCheck?: boolean;
}

/**
 * Validates and sanitizes a config file object
 */
const validateConfig = (
  config: any,
  configDir: string,
  logger?: Logger,
): ConfigFile => {
  const validated: ConfigFile = {};

  // Validate port
  if (
    typeof config.port === "number" &&
    config.port > 0 &&
    config.port <= 65535
  ) {
    validated.port = config.port;
  } else if (config.port !== undefined) {
    logger?.warn(`Invalid port in config.json: ${config.port}`);
  }

  // Validate baseUrl
  if (typeof config.baseUrl === "string") {
    validated.baseUrl = config.baseUrl;
  }

  // Validate packageDir and resolve relative paths from config directory
  if (typeof config.packageDir === "string") {
    // path.resolve handles both absolute and relative paths correctly
    // If absolute: returns as-is, if relative: resolves from configDir
    validated.packageDir = resolve(configDir, config.packageDir);
  }

  // Validate realm
  if (typeof config.realm === "string") {
    validated.realm = config.realm;
  }

  // Validate logLevel
  if (typeof config.logLevel === "string") {
    const validLevels: LogLevel[] = [
      "debug",
      "info",
      "warn",
      "error",
      "ignore",
    ];
    if (validLevels.includes(config.logLevel as LogLevel)) {
      validated.logLevel = config.logLevel as LogLevel;
    } else {
      logger?.warn(`Invalid logLevel in config.json: ${config.logLevel}`);
    }
  }

  // Validate trustedProxies
  if (Array.isArray(config.trustedProxies)) {
    const validProxies = config.trustedProxies.filter(
      (ip: any) => typeof ip === "string",
    );
    if (validProxies.length > 0) {
      validated.trustedProxies = validProxies;
    }
    if (validProxies.length !== config.trustedProxies.length) {
      logger?.warn(
        "Some invalid trusted proxy IPs in config.json were ignored",
      );
    }
  }

  // Validate authMode
  if (typeof config.authMode === "string") {
    const validModes: AuthMode[] = ["none", "publish", "full"];
    if (validModes.includes(config.authMode as AuthMode)) {
      validated.authMode = config.authMode as AuthMode;
    } else {
      logger?.warn(`Invalid authMode in config.json: ${config.authMode}`);
    }
  }

  // Validate sessionSecret
  if (typeof config.sessionSecret === "string") {
    validated.sessionSecret = config.sessionSecret;
    if (logger) {
      logger.warn(
        "Session secret found in config.json. Consider using environment variable NUGET_SERVER_SESSION_SECRET instead for better security.",
      );
    }
  }

  // Validate passwordMinScore
  if (
    typeof config.passwordMinScore === "number" &&
    config.passwordMinScore >= 0 &&
    config.passwordMinScore <= 4
  ) {
    validated.passwordMinScore = config.passwordMinScore;
  } else if (config.passwordMinScore !== undefined) {
    logger?.warn(
      `Invalid passwordMinScore in config.json: ${config.passwordMinScore}. Must be 0-4.`,
    );
  }

  // Validate passwordStrengthCheck
  if (typeof config.passwordStrengthCheck === "boolean") {
    validated.passwordStrengthCheck = config.passwordStrengthCheck;
  }

  return validated;
};

/**
 * Loads configuration from a config.json file in the specified directory
 * @param configDir Directory containing config.json
 * @param logger Optional logger for warnings
 * @returns Parsed and validated configuration object, or empty object if file doesn't exist or is invalid
 */
export const loadConfigFromFile = async (
  configDir: string,
  logger?: Logger,
): Promise<ConfigFile> => {
  const configPath = join(configDir, "config.json");

  try {
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content);

    logger?.debug(`Loaded configuration from ${configPath}`);

    return validateConfig(config, configDir, logger);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // File doesn't exist - this is normal, return empty config
      logger?.debug(`No config.json found at ${configPath}`);
      return {};
    } else if (error instanceof SyntaxError) {
      // JSON parse error
      logger?.warn(`Failed to parse config.json: ${error.message}`);
      return {};
    } else {
      // Other errors (permissions, etc.)
      logger?.warn(`Failed to load config.json: ${error.message}`);
      return {};
    }
  }
};
