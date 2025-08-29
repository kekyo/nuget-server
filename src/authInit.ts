// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import * as readline from "readline";
import { join } from "path";
import { access, mkdir } from "fs/promises";
import { constants } from "fs";
import { createUserService } from "./services/userService";
import { Logger, ServerConfig } from "./types";
import {
  checkPasswordStrength,
  getMinPasswordScore,
} from "./utils/passwordStrength";
import { promptInput, promptPassword } from "./utils/prompt";

/**
 * Options for auth initialization
 */
export interface AuthInitOptions {
  configDir: string;
  logger: Logger;
}

/**
 * Check if users.json already exists
 */
const checkUsersFileExists = async (configDir: string): Promise<boolean> => {
  const usersFilePath = join(configDir, "users.json");
  try {
    await access(usersFilePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Ensure config directory exists
 */
const ensureConfigDir = async (configDir: string): Promise<void> => {
  try {
    await access(configDir, constants.F_OK);
  } catch {
    // Directory doesn't exist, create it
    await mkdir(configDir, { recursive: true });
  }
};

/**
 * Run authentication initialization
 */
export const runAuthInit = async (
  config: ServerConfig,
  logger: Logger,
): Promise<void> => {
  const { configDir } = config;

  logger.info("Initializing authentication...");

  try {
    // Check if users.json already exists
    if (!configDir) {
      logger.error("Config directory is not defined");
      process.exit(1);
    }
    if (await checkUsersFileExists(configDir)) {
      logger.error(
        "users.json already exists. Please remove it first to initialize authentication.",
      );
      process.exit(1);
    }

    // Ensure config directory exists
    await ensureConfigDir(configDir);
    logger.debug(`Using config directory: ${configDir}`);

    // Create readline interface for regular input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      // Prompt for username (required, no default)
      const username = await promptInput(rl, "Enter admin username");

      if (!username || username.trim().length === 0) {
        logger.error("Username is required and cannot be empty");
        process.exit(1);
      }

      // Close readline interface before password input
      rl.close();

      // Prompt for password (with masking)
      let password: string;
      let confirmPassword: string;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          password = await promptPassword("Enter password");

          if (!password || password.length < 4) {
            logger.error("Password must be at least 4 characters long");
            attempts++;
            continue;
          }

          // Check password strength
          if (config.passwordStrengthCheck !== false) {
            const strength = checkPasswordStrength(password, [username]);
            const minScore = getMinPasswordScore(config);

            if (strength.score < minScore) {
              const strengthLabel = [
                "Weak",
                "Fair",
                "Good",
                "Strong",
                "Very Strong",
              ][minScore];
              logger.error(
                `Password is too weak (${strength.strength}). Minimum required: ${strengthLabel}.`,
              );
              if (strength.feedback.warning) {
                logger.info(`Hint: ${strength.feedback.warning}`);
              } else if (strength.feedback.suggestions.length > 0) {
                logger.info(`Hint: ${strength.feedback.suggestions[0]}`);
              }
              attempts++;
              continue;
            }

            logger.info(`Password strength: ${strength.strength}`);
          }

          confirmPassword = await promptPassword("Confirm password");

          if (password !== confirmPassword) {
            logger.error("Passwords do not match. Please try again.");
            attempts++;
            continue;
          }

          break; // Passwords match, exit loop
        } catch (error: any) {
          if (error.message === "Cancelled by user") {
            logger.info("Authentication initialization cancelled.");
            process.exit(0);
          }
          throw error;
        }
      }

      if (attempts >= maxAttempts) {
        logger.error("Maximum password attempts exceeded.");
        process.exit(1);
      }

      // Create user service
      const userService = createUserService({
        configDir: configDir!,
        logger,
        serverConfig: config,
      });
      await userService.initialize();

      // Create admin user
      logger.info("Creating admin user...");
      const user = await userService.createUser({
        username,
        password: password!,
        role: "admin",
      });

      // Display success message
      console.log("\n" + "=".repeat(60));
      console.log("Admin user created successfully!");
      console.log("=".repeat(60));
      console.log(`Username: ${user.username}`);
      console.log(`Role: ${user.role}`);
      console.log("=".repeat(60));
      console.log(
        "\nNote: You need to generate an API password for NuGet client authentication.",
      );
      console.log(
        "You can do this through the web UI after logging in with your username and password.",
      );
      console.log("=".repeat(60) + "\n");

      logger.info("Authentication initialization completed.");

      // Clean up
      userService.destroy();
    } catch (error: any) {
      rl.close();
      throw error;
    }
  } catch (error: any) {
    logger.error(`Authentication initialization failed: ${error.message}`);
    process.exit(1);
  }
};
