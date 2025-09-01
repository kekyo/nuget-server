// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Logger interface
 */
export interface Logger {
  /**
   * Log an debug message
   * @param msg - The message to log
   */
  readonly debug: (msg: string) => void;
  /**
   * Log an info message
   * @param msg - The message to log
   */
  readonly info: (msg: string) => void;
  /**
   * Log a warning message
   * @param msg - The message to log
   */
  readonly warn: (msg: string) => void;
  /**
   * Log an error message
   * @param msg - The message to log
   */
  readonly error: (msg: string) => void;
}

/**
 * Log levels
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "ignore";

/**
 * Authentication modes
 */
export type AuthMode = "none" | "publish" | "full";

/**
 * Duplicate package handling policy
 */
export type DuplicatePackagePolicy = "overwrite" | "ignore" | "error";

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  baseUrl?: string;
  packageDir?: string;
  configDir?: string;
  usersFile?: string; // Path to users.json file (absolute or relative to configDir)
  trustedProxies?: string[];
  realm?: string;
  logLevel?: LogLevel;
  authMode?: AuthMode;
  sessionSecret?: string;
  passwordMinScore?: number; // 0-4, default: 2 (Good)
  passwordStrengthCheck?: boolean; // default: true
  duplicatePackagePolicy?: DuplicatePackagePolicy; // default: "ignore"
}

/**
 * Extend Fastify types for AbortSignal support
 */
declare module "fastify" {
  interface FastifyRequest {
    abortSignal: AbortSignal;
  }
}
