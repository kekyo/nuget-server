// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import type AdmZip from 'adm-zip';
import { constants } from 'fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'fs/promises';
import { basename, dirname, extname, join, resolve } from 'path';
import type { Logger } from '../types.ts';
import { readNuspecIdentity } from '../utils/nuspec.ts';

const directChild = (parent: string, name: string): string => {
  const child = resolve(parent, name);
  if (dirname(child) !== parent || basename(child) !== name) {
    throw new Error('Invalid package storage path');
  }
  return child;
};

/**
 * Builds the archive path below the configured storage root.
 * @param root - Trusted package storage root.
 * @param id - NuGet package ID.
 * @param version - NuGet package version.
 * @returns The absolute path to the archive inside its version directory.
 */
export const packageArchivePath = (
  root: string,
  id: string,
  version: string
): string => {
  readNuspecIdentity(id, version);
  const packageDir = directChild(resolve(root), id);
  const versionDir = directChild(packageDir, version);
  return directChild(versionDir, `${id}.${version}.nupkg`);
};

const inspectPath = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

const iconExtensions = new Set(['.png', '.jpg', '.jpeg']);

// Claim an incomplete version without replacing an archive that another publisher just installed.
const installNewArchive = async (
  source: string,
  destination: string
): Promise<boolean> => {
  try {
    await link(source, destination);
  } catch {
    // Storage volumes that cannot create hard links can still use exclusive copies.
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }
  return true;
};

/**
 * Saves a package and its manifest together, and extracts its optional PNG or JPEG icon.
 * @param root - Trusted package storage root.
 * @param identity - Package ID and version used for storage.
 * @param content - Original archive bytes and manifest text, parsed ZIP, and optional icon entry name.
 * @param overwrite - Whether an existing version may be replaced.
 * @param logger - Logger for optional icon extraction.
 * @returns True when the files were saved, or false when the version already exists.
 */
export const savePackageFiles = async (
  root: string,
  identity: { id: string; version: string },
  content: { archive: Buffer; nuspec: string; zip: AdmZip; icon: unknown },
  overwrite: boolean,
  logger: Logger
): Promise<boolean> => {
  const { id, version } = identity;
  const { archive, nuspec, zip, icon } = content;
  const archivePath = packageArchivePath(root, id, version);
  const versionDir = dirname(archivePath);
  const packageDir = dirname(versionDir);
  const files = new Map<string, string | Buffer | undefined>();

  // Save nuspec file and extract the icon if present.
  files.set(directChild(versionDir, `${id}.nuspec`), nuspec);
  if (
    typeof icon === 'string' &&
    iconExtensions.has(extname(icon).toLowerCase())
  ) {
    try {
      const entry = zip.getEntry(icon);
      if (entry && !entry.isDirectory) {
        const name = `icon${extname(icon).toLowerCase()}`;
        files.set(directChild(versionDir, name), entry.getData());
        logger.debug(`Extracted icon: ${name} for ${id} ${version}`);
      } else {
        logger.warn(
          `Icon specified in nuspec but not found in package ${id} ${version}`
        );
      }
    } catch (error) {
      logger.warn(`Failed to extract icon for ${id} ${version}: ${error}`);
    }
  }
  if (overwrite) {
    // Remove previously extracted icons that are absent from the replacement package.
    for (const extension of [...iconExtensions, '.gif', '.svg']) {
      const target = directChild(versionDir, `icon${extension}`);
      if (!files.has(target)) files.set(target, undefined);
    }
  }
  // Install the archive last when replacing an existing version.
  files.set(archivePath, archive);

  await mkdir(resolve(root), { recursive: true });
  await mkdir(packageDir, { recursive: true });
  if (!(await lstat(packageDir)).isDirectory()) {
    throw new Error('Invalid package directory');
  }
  const existing = await inspectPath(versionDir);
  if (existing && !existing.isDirectory())
    throw new Error('Invalid version directory');

  // Stage on the same filesystem as the destination, including versions on a separate volume.
  const staging = await mkdtemp(
    join(existing ? versionDir : packageDir, '.publish-')
  );
  const prepared = join(staging, 'files');
  let keepBackups = false;
  try {
    await mkdir(prepared);
    for (const [target, content] of files) {
      if (content !== undefined)
        await writeFile(join(prepared, basename(target)), content);
    }
    if (!existing) {
      try {
        await rename(prepared, versionDir);
        return true;
      } catch (error) {
        // Another process may have finished publishing the same version.
        if (!(await inspectPath(versionDir))?.isDirectory()) throw error;
      }
    }

    const previousArchive = await inspectPath(archivePath);
    if (previousArchive && !previousArchive.isFile())
      throw new Error('Invalid package archive destination');
    if (previousArchive && !overwrite) return false;

    // Preserve unrelated files. Back up the files being replaced before installing any of them.
    const backups = new Map<string, string>();
    for (const target of files.keys()) {
      if (!overwrite && target === archivePath) continue;
      const previous = await inspectPath(target);
      if (!previous) continue;
      if (!previous.isFile())
        throw new Error('Invalid package file destination');
      const backup = join(staging, basename(target));
      await copyFile(target, backup);
      backups.set(target, backup);
    }
    const installed: string[] = [];
    try {
      if (!overwrite) {
        const source = join(prepared, basename(archivePath));
        if (!(await installNewArchive(source, archivePath))) return false;
        installed.push(archivePath);
      }
      for (const [target, content] of files) {
        if (!overwrite && target === archivePath) continue;
        const source = join(prepared, basename(target));
        if (content === undefined) {
          if (!backups.has(target)) continue;
          await rm(target);
        } else {
          await rename(source, target);
        }
        installed.push(target);
      }
    } catch (error) {
      try {
        for (const target of installed.reverse()) {
          const backup = backups.get(target);
          if (backup) await rename(backup, target);
          else await rm(target);
        }
      } catch (restoreError) {
        keepBackups = true;
        logger.error(
          `Failed to restore ${id} ${version}, retained backups in ${staging}: ${restoreError}`
        );
      }
      throw error;
    }
    return true;
  } finally {
    if (!keepBackups) {
      try {
        await rm(staging, { recursive: true, force: true });
      } catch (error) {
        logger.warn(
          `Failed to remove package staging directory ${staging}: ${error}`
        );
      }
    }
  }
};
