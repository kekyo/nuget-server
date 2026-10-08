// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { access } from 'fs/promises';
import { join } from 'path';
import { createUserService } from './services/userService';
import { Logger, ServerConfig } from './types';

/**
 * Removes a user's second factor for offline account recovery.
 * @param config Server configuration identifying the account store.
 * @param logger Destination for the recovery audit message.
 * @param username Account to reset.
 * @returns Resolves after the change is persisted.
 * @remarks Stop the server before running this command. The encryption key is
 * not required, and passwords and other accounts are preserved.
 */
export const runTotpReset = async (
  config: ServerConfig,
  logger: Logger,
  username: string
): Promise<void> => {
  const configDir = config.configDir || './';
  const usersFile = config.usersFile || join(configDir, 'users.json');
  await access(usersFile);
  const users = createUserService({
    configDir,
    usersFile,
    logger,
    serverConfig: config,
  });
  try {
    await users.initialize();
    const user = await users.getUser(username);
    if (!user) throw new Error(`User not found: ${username}`);
    if (!user.totp) {
      logger.info(
        `Two-factor authentication is already disabled for ${username}`
      );
      return;
    }
    await users.mutateTotp(
      username,
      user.authVersion ?? 0,
      () => undefined,
      true
    );
    logger.warn(
      `Two-factor authentication reset for ${username}. Register a new authenticator after signing in.`
    );
  } finally {
    users.destroy();
  }
};
