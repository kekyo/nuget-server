// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Plugin, ViteDevServer } from 'vite';
import { FastifyInstance } from 'fastify';
import { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';
import { createReaderWriterLock } from 'async-primitives';
import { createFastifyInstance } from '../server';
import { LogLevel, ServerConfig } from '../types';
import { createConsoleLogger } from '../logger';
import { name } from '../generated/packageMetadata';

// Vite plugin for combining both fastify server and UI on development.

type HTTPMethods = 'DELETE' | 'delete' | 'GET' | 'get' | 'HEAD' | 'head' | 
                   'PATCH' | 'patch' | 'POST' | 'post' | 'PUT' | 'put' | 'OPTIONS' | 'options';

/**
 * Convert Node.js IncomingMessage to a Readable stream for Fastify inject
 */
const requestToStream = (req: IncomingMessage): Readable => {
  const stream = new Readable({
    read() {}
  });
  
  req.on('data', (chunk) => {
    stream.push(chunk);
  });
  
  req.on('end', () => {
    stream.push(null);
  });
  
  req.on('error', (err) => {
    stream.destroy(err);
  });
  
  return stream;
};

/**
 * Vite plugin for Fastify integration
 * Runs Fastify server in the same process as Vite dev server
 */
export const fastifyHost = (config: ServerConfig): Plugin => {
  let fastify: FastifyInstance | null = null;
  let logger = createConsoleLogger(`${name} vite`, 'debug');
  const locker = createReaderWriterLock();

  return {
    name: 'vite-plugin-fastify',

    configureServer: async (server: ViteDevServer) => {
      const logLevel = server.config.logLevel as LogLevel ?? 'info';
      //logger = createConsoleLogger(`${name} vite`, logLevel);    // TODO: Restore commented out

      // Initialize Fastify instance
      logger.info('Initializing Fastify instance for development...');
      try {
        fastify = await createFastifyInstance(config, logger, locker);
        logger.info('Fastify instance created successfully');
      } catch (error) {
        logger.error(`Failed to create Fastify instance: ${error}`);
        throw error;
      }
      
      // Add middleware to handle API requests
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url || '';
        
        // Check if this is an API request
        if (url.startsWith('/api/') || url.startsWith('/v3/') || url === '/health' || url === '/favicon.ico' || url === '/icon.png') {
          if (!fastify) {
            res.statusCode = 503;
            res.end('Fastify server not initialized');
            return;
          }
          
          try {
            // Use Fastify inject to handle the request
            const response = await fastify.inject({
              method: (req.method || 'GET') as HTTPMethods,
              url: url,
              headers: req.headers as any,
              payload: requestToStream(req)
            });
            
            // Set response status
            res.statusCode = response.statusCode;
            
            // Set response headers
            const headers = response.headers;
            if (typeof headers === 'object') {
              Object.entries(headers).forEach(([key, value]) => {
                if (value !== undefined) {
                  res.setHeader(key, String(value));
                }
              });
            }
            
            // Send response body
            // Use rawPayload (Buffer) to handle binary data correctly
            res.end(response.rawPayload);
          } catch (error) {
            logger.error(`Error handling request ${url}: ${error}`);
            res.statusCode = 500;
            res.end('Internal Server Error');
          }
        } else {
          // Not an API request, pass to next middleware
          next();
        }
      });
      
      // Watch for server file changes and reload Fastify
      server.watcher.on('change', async (file: string) => {
        // Check if the changed file is a server file (not UI)
        if (file.includes('/src/') && !file.includes('/src/ui/')) {
          logger.info(`Server file changed: ${file}`);
          
          // Close existing Fastify instance
          if (fastify) {
            const handler = await locker.writeLock();
            try {
              await fastify.close();
              const userService = (fastify as any).userService;
              const sessionService = (fastify as any).sessionService;
              if (userService) userService.destroy();
              if (sessionService) sessionService.destroy();
            } catch (error) {
              logger.error(`Error closing Fastify: ${error}`);
            } finally {
              handler.release();
            }
          }
          
          // Recreate Fastify instance
          try {
            logger.info('Reloading Fastify instance...');
            fastify = await createFastifyInstance(config, logger, locker);
            logger.info('Fastify instance reloaded successfully');
          } catch (error) {
            logger.error(`Failed to reload Fastify instance: ${error}`);
            fastify = null;
          }
        }
      });
    },
    
    closeBundle: async () => {
      // Clean up Fastify instance
      if (fastify) {
        const handler = await locker.writeLock();
        try {
          await fastify.close();
          const userService = (fastify as any).userService;
          const sessionService = (fastify as any).sessionService;
          if (userService) userService.destroy();
          if (sessionService) sessionService.destroy();
          logger.info('Fastify instance closed');
        } catch (error) {
          logger.error(`Error closing Fastify: ${error}`);
        } finally {
          handler.release();
        }
      }
    }
  };
};
