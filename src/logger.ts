// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Logger } from "./types";

/**
 * Create a console logger
 * @param prefix - Optional prefix
 * @returns The logger
 */
export const createConsoleLogger = (prefix?: string) : Logger => {
  return prefix ? {
    debug: msg => console.debug(`[${prefix}]: ${msg}`),
    info: msg => console.info(`[${prefix}]: ${msg}`),
    warn: msg =>console.warn(`[${prefix}]: ${msg}`),
    error: msg =>console.error(`[${prefix}]: ${msg}`)
  } : {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
};
