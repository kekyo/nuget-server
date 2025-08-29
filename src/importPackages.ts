// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import * as readline from "readline";
import { ServerConfig, Logger } from "./types";
import { createImportService, ImportProgress } from "./services/importService";

/**
 * Options for package import
 */
export interface ImportPackagesOptions {
  packageDir: string;
  logger: Logger;
}

/**
 * Prompts for user input with optional default value
 */
const promptInput = (
  rl: readline.Interface,
  prompt: string,
  defaultValue?: string,
): Promise<string> => {
  return new Promise((resolve) => {
    const displayPrompt = defaultValue
      ? `${prompt} [${defaultValue}]: `
      : `${prompt}: `;
    rl.question(displayPrompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
};

/**
 * Prompts for password input (hidden)
 */
const promptPassword = (prompt: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Check if we're in an interactive terminal
    if (!process.stdin.isTTY) {
      // Non-interactive mode: read from stdin without masking
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });

      process.stdout.write(`${prompt}: `);

      rl.once("line", (input) => {
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      });

      return;
    }

    // Interactive mode: mask password input
    process.stdout.write(`${prompt}: `);

    // Set raw mode to hide input completely
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let password = "";

    const onData = (char: Buffer) => {
      const str = char.toString();

      switch (str) {
        case "\u0003": // Ctrl+C
          process.stdout.write("\n");
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          reject(new Error("Cancelled by user"));
          break;

        case "\r":
        case "\n": // Enter
          process.stdout.write("\n");
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          resolve(password);
          break;

        case "\u007F": // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write("\b \b"); // Move back, write space, move back again
          }
          break;

        default:
          // Only accept printable characters
          if (str.charCodeAt(0) >= 32 && str.charCodeAt(0) < 127) {
            password += str;
            process.stdout.write("*");
          }
          break;
      }
    };

    process.stdin.on("data", onData);
  });
};

/**
 * Prompts for yes/no confirmation
 */
const promptConfirm = (
  rl: readline.Interface,
  prompt: string,
  defaultValue: boolean = false,
): Promise<boolean> => {
  return new Promise((resolve) => {
    const defaultStr = defaultValue ? "Y/n" : "y/N";
    rl.question(`${prompt} [${defaultStr}]: `, (answer) => {
      const normalized = answer.trim().toLowerCase();
      if (normalized === "") {
        resolve(defaultValue);
      } else {
        resolve(normalized === "y" || normalized === "yes");
      }
    });
  });
};

/**
 * Format progress message
 */
const formatProgress = (progress: ImportProgress): string => {
  const percentage =
    progress.totalVersions > 0
      ? ((progress.downloadedVersions / progress.totalVersions) * 100).toFixed(
          1,
        )
      : "0.0";

  return `Downloaded: ${progress.downloadedVersions}/${progress.totalVersions} packages (${percentage}%)`;
};

/**
 * Run package import process
 */
export const runImportPackages = async (
  config: ServerConfig,
  logger: Logger,
): Promise<void> => {
  const { packageDir } = config;

  logger.info("Starting package import...");

  // Create readline interface for regular input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Prompt for source server URL
    const sourceUrl = await promptInput(
      rl,
      "Enter source NuGet server URL",
      "https://api.nuget.org/v3",
    );

    if (!sourceUrl) {
      logger.error("Server URL cannot be empty");
      process.exit(1);
    }

    // Validate URL format
    try {
      new URL(sourceUrl);
    } catch {
      logger.error("Invalid URL format");
      process.exit(1);
    }

    // Prompt for authentication
    const needsAuth = await promptConfirm(
      rl,
      "Does the server require authentication?",
      false,
    );

    let username: string | undefined;
    let password: string | undefined;

    if (needsAuth) {
      username = await promptInput(rl, "Enter username");
      if (!username) {
        logger.error(
          "Username cannot be empty when authentication is required",
        );
        process.exit(1);
      }

      // Close readline before password input
      rl.close();

      try {
        password = await promptPassword("Enter password");
        if (!password) {
          logger.error(
            "Password cannot be empty when authentication is required",
          );
          process.exit(1);
        }
      } catch (error: any) {
        if (error.message === "Cancelled by user") {
          logger.info("Import cancelled by user.");
          process.exit(0);
        }
        throw error;
      }

      // Recreate readline interface after password input
      const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Confirm import
      console.log("\n" + "=".repeat(60));
      console.log("Import Configuration:");
      console.log(`Source: ${sourceUrl}`);
      console.log(`Target: ${packageDir}`);
      console.log(`Authentication: ${username} (password hidden)`);
      console.log("=".repeat(60) + "\n");

      const confirmed = await promptConfirm(
        rl2,
        "Start importing packages? (existing packages will be overwritten)",
        false,
      );

      rl2.close();

      if (!confirmed) {
        logger.info("Import cancelled by user.");
        process.exit(0);
      }
    } else {
      // Confirm import without auth
      console.log("\n" + "=".repeat(60));
      console.log("Import Configuration:");
      console.log(`Source: ${sourceUrl}`);
      console.log(`Target: ${packageDir}`);
      console.log(`Authentication: None`);
      console.log("=".repeat(60) + "\n");

      const confirmed = await promptConfirm(
        rl,
        "Start importing packages? (existing packages will be overwritten)",
        false,
      );

      rl.close();

      if (!confirmed) {
        logger.info("Import cancelled by user.");
        process.exit(0);
      }
    }

    // Create import service
    const importService = createImportService({
      sourceUrl,
      username,
      password,
      packageDir: packageDir!,
      logger,
      onProgress: (progress: ImportProgress) => {
        // Clear the line and write progress
        process.stdout.write("\r" + " ".repeat(80) + "\r");
        process.stdout.write(formatProgress(progress));

        if (progress.currentPackage && progress.currentVersion) {
          process.stdout.write(
            ` - ${progress.currentPackage}@${progress.currentVersion}`,
          );
        }
      },
    });

    // Discover packages
    logger.info("Discovering packages from source server...");
    const packages = await importService.discoverPackages();

    if (packages.length === 0) {
      logger.info("No packages found on the source server.");
      process.exit(0);
    }

    const totalVersions = packages.reduce(
      (sum, p) => sum + p.versions.length,
      0,
    );
    console.log(
      `\nFound ${packages.length} packages with ${totalVersions} versions total.`,
    );

    // Start import
    logger.info("Starting package import...");
    const startTime = Date.now();

    const result = await importService.importPackages(packages);

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Clear the progress line
    process.stdout.write("\r" + " ".repeat(80) + "\r");

    // Display results
    console.log("\n" + "=".repeat(60));
    console.log("Import Complete!");
    console.log("=".repeat(60));
    console.log(`Total packages: ${result.totalPackages}`);
    console.log(`Total versions: ${result.totalVersions}`);
    console.log(`Successfully imported: ${result.successfulVersions}`);
    console.log(`Failed: ${result.failedVersions}`);
    console.log(`Time elapsed: ${elapsedTime} seconds`);

    if (result.failures.length > 0) {
      console.log("\nFailed imports:");
      for (const failure of result.failures.slice(0, 10)) {
        console.log(
          `  - ${failure.packageId}@${failure.version}: ${failure.error}`,
        );
      }
      if (result.failures.length > 10) {
        console.log(`  ... and ${result.failures.length - 10} more`);
      }
    }

    console.log("=".repeat(60) + "\n");

    logger.info("Package import completed.");
  } catch (error: any) {
    rl.close();
    logger.error(`Package import failed: ${error.message}`);
    process.exit(1);
  }
};
