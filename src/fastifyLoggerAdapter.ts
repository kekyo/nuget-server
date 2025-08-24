// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Logger, LogLevel } from './types';

/**
 * Format log message from various input types
 */
const formatMessage = (obj: any, msg?: string, ...args: any[]): string => {
  // String only case
  if (typeof obj === 'string') {
    return obj;
  }
  
  // Object with message case
  if (msg) {
    // Handle error object specially
    if (obj && obj.err) {
      const error = obj.err;
      if (error instanceof Error) {
        return `${msg}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
      }
      return `${msg}: ${JSON.stringify(error)}`;
    }
    // Regular object with message
    return `${msg} ${JSON.stringify(obj)}`;
  }
  
  // Object only case
  if (obj && typeof obj === 'object') {
    // Error object
    if (obj instanceof Error) {
      return `${obj.message}${obj.stack ? `\n${obj.stack}` : ''}`;
    }
    // Plain object
    return JSON.stringify(obj);
  }
  
  // Fallback for other types
  return String(obj);
};

/**
 * Create a Fastify-compatible logger adapter from project Logger
 * @param logger - Project logger instance
 * @param logLevel - Log level for Fastify logger configuration
 * @returns Fastify-compatible logger object
 */
export const createFastifyLoggerAdapter = (logger: Logger, logLevel: LogLevel = 'info') => {
  const adapter = {
    // Basic log methods required by Fastify
    info: (obj: any, msg?: string, ...args: any[]) => {
      const message = formatMessage(obj, msg, ...args);
      logger.info(message);
    },
    
    error: (obj: any, msg?: string, ...args: any[]) => {
      const message = formatMessage(obj, msg, ...args);
      logger.error(message);
    },
    
    debug: (obj: any, msg?: string, ...args: any[]) => {
      const message = formatMessage(obj, msg, ...args);
      logger.debug(message);
    },
    
    warn: (obj: any, msg?: string, ...args: any[]) => {
      const message = formatMessage(obj, msg, ...args);
      logger.warn(message);
    },
    
    // Additional methods required by Fastify but not in project Logger
    fatal: (obj: any, msg?: string, ...args: any[]) => {
      const message = formatMessage(obj, msg, ...args);
      logger.error(`[FATAL] ${message}`);
    },
    
    trace: (obj: any, msg?: string, ...args: any[]) => {
      const message = formatMessage(obj, msg, ...args);
      logger.debug(`[TRACE] ${message}`);
    },
    
    // Child logger factory - returns same adapter for simplicity
    // In future, could add request context bindings here
    child: (bindings?: any) => {
      // For now, return the same adapter
      // Could enhance to include bindings in future
      return adapter;
    },
    
    // Additional properties required by FastifyBaseLogger
    level: logLevel,
    silent: logLevel === 'ignore',
    msgPrefix: ''
  };
  
  return adapter;
};