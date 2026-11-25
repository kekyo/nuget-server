// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyReply } from 'fastify';
import type { Logger } from '../types.ts';
import type { ReaderWriterLock } from 'async-primitives';

/**
 * Options for file streaming
 */
export interface StreamFileOptions {
  /** Override Content-Type header */
  contentType?: string;
  /** Set Content-Disposition header */
  contentDisposition?: string;
  /** Set Cache-Control header */
  cacheControl?: string;
}

/**
 * Opens a regular file beneath an operator-configured directory.
 * @param root - Trusted directory (it may itself be a configured symlink).
 * @param filePath - Relative path within the directory.
 * @returns The open descriptor. The caller must close the descriptor.
 * @throws ENOENT for paths outside the directory or non-regular files.
 */
const openUiFile = async (
  root: string,
  filePath: string
): Promise<FileHandle> => {
  const unavailable = () =>
    Object.assign(new Error('File not found'), { code: 'ENOENT' });
  if (filePath.includes('\0')) throw unavailable();
  const directory = await realpath(root);
  const candidate = resolve(directory, filePath);
  if (
    !candidate.startsWith(directory.endsWith(sep) ? directory : directory + sep)
  )
    throw unavailable();
  if ((await realpath(candidate)) !== candidate) throw unavailable();
  const file = await open(
    candidate,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0)
  );
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw unavailable();
    // Check that the descriptor belongs to the validated directory entry even
    // when another writer replaces a file between path resolution and open.
    const entry = await lstat(candidate);
    if (
      entry.dev !== stats.dev ||
      entry.ino !== stats.ino ||
      (await realpath(candidate)) !== candidate
    )
      throw unavailable();
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
};

// Use the same descriptor for Content-Length and the response body, including with Fastify inject.
const sendFile = async (
  logger: Logger,
  locker: ReaderWriterLock,
  filePath: string,
  openFile: () => Promise<FileHandle>,
  reply: FastifyReply,
  options: StreamFileOptions,
  signal: AbortSignal | undefined
): Promise<void> => {
  // Acquire reader lock with signal support
  const handle = await locker.readLock(signal);
  try {
    const file = await openFile();
    try {
      const stats = await file.stat();
      if (!stats.isFile())
        return await reply.status(404).send({ error: 'Not a file' });
      // Determine Content-Type (use provided type or auto-detect from extension)
      reply.header(
        'Content-Type',
        options.contentType ?? getMimeTypeFromExtension(extname(filePath))
      );
      reply.header('Content-Length', stats.size);
      // Set optional headers if provided
      if (options.contentDisposition)
        reply.header('Content-Disposition', options.contentDisposition);
      if (options.cacheControl)
        reply.header('Cache-Control', options.cacheControl);
      logger.debug('Streaming ' + filePath);
      const stream = file.createReadStream({ signal, autoClose: false });
      try {
        await reply.send(stream);
      } finally {
        stream.destroy();
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Handle file not found and permission errors
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP')
      return await reply.status(404).send({ error: 'File not found' });
    if (code === 'EACCES')
      return await reply.status(403).send({ error: 'Permission denied' });
    throw error;
  } finally {
    // Release reader lock
    handle.release();
  }
};

/**
 * Stream a file to the client using createReadStream
 *
 * This function provides a unified way to send files that works correctly
 * in both regular HTTP environments and fastify.inject() environments (like Vite dev server).
 *
 * Features:
 * - Memory efficient streaming (no loading entire file into memory)
 * - Works with fastify.inject() method used by Vite plugin
 * - Automatic Content-Type detection based on file extension
 * - Proper error handling for missing files
 * - Support for optional headers (cache control, content disposition)
 *
 * @param logger - Logger instance
 * @param locker - Reader lock for file streaming
 * @param filePath - Absolute path to the file to stream
 * @param reply - Fastify reply object
 * @param options - Optional headers and configuration
 * @param signal - Optional AbortSignal for cancellation support
 * @returns Resolves when the response has been sent
 */
export const streamFile = async (
  logger: Logger,
  locker: ReaderWriterLock,
  filePath: string,
  reply: FastifyReply,
  options: StreamFileOptions = {},
  signal?: AbortSignal
): Promise<void> =>
  await sendFile(
    logger,
    locker,
    filePath,
    () => open(filePath, 'r'),
    reply,
    options,
    signal
  );

/**
 * Streams a UI resource from its configured asset directory.
 * @param logger - Stream logger.
 * @param locker - Reader lock held until the response completes.
 * @param root - Trusted directory for this class of UI assets.
 * @param filePath - Relative asset name.
 * @param reply - HTTP response.
 * @param signal - Cancellation on disconnect.
 * @returns Resolves after sending the asset or its HTTP error.
 */
export const streamUiFile = async (
  logger: Logger,
  locker: ReaderWriterLock,
  root: string,
  filePath: string,
  reply: FastifyReply,
  signal: AbortSignal | undefined
): Promise<void> =>
  await sendFile(
    logger,
    locker,
    filePath,
    () => openUiFile(root, filePath),
    reply,
    {},
    signal
  );

/**
 * Get MIME type based on file extension
 * @param ext - File extension (including the dot)
 * @returns MIME type string
 */
function getMimeTypeFromExtension(ext: string): string {
  const mimeTypes: { [key: string]: string } = {
    // Web files
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.txt': 'text/plain',

    // Image files
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',

    // Archive files
    '.nupkg': 'application/zip',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',

    // Font files
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',

    // Other common files
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}
