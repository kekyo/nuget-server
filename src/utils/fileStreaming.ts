// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { FastifyReply } from 'fastify';
import { extname } from 'path';
import { Logger } from '../types';
import { createDeferred, ReaderWriterLock } from 'async-primitives';

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
 * @returns Promise that resolves to the FastifyReply
 */
export const streamFile = async (
  logger: Logger,
  locker: ReaderWriterLock,
  filePath: string,
  reply: FastifyReply,
  options: StreamFileOptions = {},
  signal?: AbortSignal
): Promise<void> => {
  // Acquire reader lock with signal support
  const handler = await locker.readLock(signal);
  try {
    // Check if file exists and get its stats
    const stats = await stat(filePath);
    
    if (!stats.isFile()) {
      return reply.status(404).send({ error: 'Not a file' });
    }
    
    // Determine Content-Type (use provided type or auto-detect from extension)
    const contentType = options.contentType || getMimeTypeFromExtension(extname(filePath));
    
    // Set response headers
    reply.header('Content-Type', contentType);
    reply.header('Content-Length', stats.size);
    
    // Set optional headers if provided
    if (options.contentDisposition) {
      reply.header('Content-Disposition', options.contentDisposition);
    }
    
    if (options.cacheControl) {
      reply.header('Cache-Control', options.cacheControl);
    }
    
    // Add stream event logging for debugging
    const streamId = `stream-${Date.now()}`;
    const shortPath = filePath.split('/').slice(-3).join('/');
    logger.debug(`[${streamId}] Creating stream for ${shortPath}`);

    // Also log when reply is sent
    logger.debug(`[${streamId}] Sending stream to reply at ${Date.now()}`);

    // Create and send file stream
    const deferred = createDeferred<void>();
    const stream = createReadStream(filePath);

    // Prevent multiple resolutions
    let resolved = false;
    const resolveOnce = () => {
      if (!resolved) {
        resolved = true;
        deferred.resolve();
      }
    };

    // Handle abort signal if provided
    if (signal) {
      const abortHandler = () => {
        logger.info(`[${streamId}] Stream aborted by client disconnect for ${shortPath}`);
        stream.destroy();
        resolveOnce();
      };
      
      // Check if already aborted
      if (signal.aborted) {
        abortHandler();
        return;
      }
      
      // Listen for abort event
      signal.addEventListener('abort', abortHandler);
    }

    stream.on('open', () => {
      logger.debug(`[${streamId}] Event: open at ${Date.now()}`);
    });

    stream.on('data', (chunk) => {
      logger.debug(`[${streamId}] Event: data (${chunk.length} bytes) at ${Date.now()}`);
    });

    // Resolve on 'end' event (stream read complete)
    stream.on('end', () => {
      logger.debug(`[${streamId}] Event: end (read complete) at ${Date.now()}`);
      //resolveOnce(); // Resolve here to avoid waiting for close event
    });

    stream.on('finish', () => {
      logger.debug(`[${streamId}] Event: finish at ${Date.now()}`);
    });

    // Also resolve on 'close' event as a fallback
    stream.on('close', () => {
      logger.debug(`[${streamId}] Event: close at ${Date.now()}`);
      resolveOnce();
    });

    // Handle stream errors
    stream.on('error', error => {
      logger.debug(`[${streamId}] Event: error at ${Date.now()}`);
      deferred.reject(error);
    });

    try {
      await reply.send(stream);
      await deferred.promise;
    } finally {
      stream.destroy(); // Use destroy instead of close for more reliable cleanup
    }
  } catch (error: any) {
    // Handle file not found error
    if (error.code === 'ENOENT') {
      return reply.status(404).send({ error: 'File not found' });
    }
    
    // Handle permission errors
    if (error.code === 'EACCES') {
      return reply.status(403).send({ error: 'Permission denied' });
    }
    
    // Handle other errors
    throw error;
  } finally {
    // Release reader lock
    handler.release();
  }
};

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
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}