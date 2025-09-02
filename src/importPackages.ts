// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import * as readline from 'readline';
import { ServerConfig, Logger } from './types';
import { createImportService, ImportProgress } from './services/importService';
import { promptInput, promptPassword, promptConfirm } from './utils/prompt';

/**
 * Options for package import
 */
export interface ImportPackagesOptions {
  packageDir: string;
  logger: Logger;
}

/**
 * Run package import process
 */
export const runImportPackages = async (
  config: ServerConfig,
  logger: Logger
): Promise<void> => {
  const { packageDir } = config;

  logger.info('Starting package import...');

  // Create readline interface for regular input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Prompt for source server URL
    const sourceUrl = await promptInput(
      rl,
      'Enter source NuGet server URL',
      'http://host.example.com/repository/nuget/'
    );

    if (!sourceUrl) {
      logger.error('Server URL cannot be empty');
      process.exit(1);
    }

    // Validate URL format
    try {
      new URL(sourceUrl);
    } catch {
      logger.error('Invalid URL format');
      process.exit(1);
    }

    // Prompt for authentication
    const needsAuth = await promptConfirm(
      rl,
      'Does the server require authentication?',
      false
    );

    let username: string | undefined;
    let password: string | undefined;

    if (needsAuth) {
      username = await promptInput(rl, 'Enter username');
      if (!username) {
        logger.error(
          'Username cannot be empty when authentication is required'
        );
        process.exit(1);
      }

      // Close readline before password input
      rl.close();

      try {
        password = await promptPassword('Enter password');
        if (!password) {
          logger.error(
            'Password cannot be empty when authentication is required'
          );
          process.exit(1);
        }
      } catch (error: any) {
        if (error.message === 'Cancelled by user') {
          logger.info('Import cancelled by user.');
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
      logger.info('='.repeat(60));
      logger.info('Import Configuration:');
      logger.info(`Source: ${sourceUrl}`);
      logger.info(`Target: ${packageDir}`);
      logger.info(`Authentication: ${username} (password hidden)`);
      logger.info('='.repeat(60));

      const confirmed = await promptConfirm(
        rl2,
        'Start importing packages? (existing packages will be overwritten)',
        false
      );

      rl2.close();

      if (!confirmed) {
        logger.info('Import cancelled by user.');
        process.exit(0);
      }
    } else {
      // Confirm import without auth
      logger.info('='.repeat(60));
      logger.info('Import Configuration:');
      logger.info(`Source: ${sourceUrl}`);
      logger.info(`Target: ${packageDir}`);
      logger.info(`Authentication: None`);
      logger.info('='.repeat(60));

      const confirmed = await promptConfirm(
        rl,
        'Start importing packages? (existing packages will be overwritten)',
        false
      );

      rl.close();

      if (!confirmed) {
        logger.info('Import cancelled by user.');
        process.exit(0);
      }
    }

    // Create import service
    let lastPercentage = -1;
    const importService = createImportService({
      sourceUrl,
      username,
      password,
      packageDir: packageDir!,
      logger,
      onProgress: (progress: ImportProgress) => {
        const percentage =
          progress.totalVersions > 0
            ? Math.floor(
                (progress.downloadedVersions / progress.totalVersions) * 100
              )
            : 0;

        // Update only at 1% intervals or on completion
        if (
          percentage !== lastPercentage ||
          progress.downloadedVersions === progress.totalVersions
        ) {
          lastPercentage = percentage;
          const packageInfo =
            progress.currentPackage && progress.currentVersion
              ? ` - ${progress.currentPackage}@${progress.currentVersion}`
              : '';
          logger.info(
            `Progress: ${progress.downloadedVersions}/${progress.totalVersions} packages (${percentage}%)${packageInfo}`
          );
        }
      },
    });

    // Discover packages
    logger.info('Discovering packages from source server...');
    const packages = await importService.discoverPackages();

    if (packages.length === 0) {
      logger.info('No packages found on the source server.');
      process.exit(0);
    }

    const totalVersions = packages.reduce(
      (sum, p) => sum + p.versions.length,
      0
    );
    logger.info(
      `Found ${packages.length} packages with ${totalVersions} versions total.`
    );

    // Start import
    logger.info('Starting package import...');
    const startTime = Date.now();

    const result = await importService.importPackages(packages);

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Display results
    logger.info('='.repeat(60));
    logger.info('Import Complete!');
    logger.info('='.repeat(60));
    logger.info(`Total packages: ${result.totalPackages}`);
    logger.info(`Total versions: ${result.totalVersions}`);
    logger.info(`Successfully imported: ${result.successfulVersions}`);
    logger.info(`Failed: ${result.failedVersions}`);
    logger.info(`Time elapsed: ${elapsedTime} seconds`);

    if (result.failures.length > 0) {
      logger.info('Failed imports:');
      for (const failure of result.failures.slice(0, 10)) {
        logger.error(
          `  - ${failure.packageId}@${failure.version}: ${failure.error}`
        );
      }
      if (result.failures.length > 10) {
        logger.info(`  ... and ${result.failures.length - 10} more`);
      }
    }

    logger.info('='.repeat(60));

    logger.info('Package import completed.');
  } catch (error: any) {
    rl.close();
    logger.error(`Package import failed: ${error.message}`);
    process.exit(1);
  }
};
