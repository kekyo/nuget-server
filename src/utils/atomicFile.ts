// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { constants } from 'fs';
import { access, open, rename, rm } from 'fs/promises';
import { randomBytes } from 'crypto';

/**
 * Replaces a private file only after its new contents have been written and synced.
 * @param filePath Destination in an existing, writable directory.
 * @param content Complete replacement contents.
 * @returns Resolves after the replacement has completed.
 * @remarks Preserves explicit read-only protection of an existing destination.
 */
export const writePrivateFile = async (
  filePath: string,
  content: string
): Promise<void> => {
  try {
    await access(filePath, constants.W_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporaryPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
  try {
    const file = await open(temporaryPath, 'wx', 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};
