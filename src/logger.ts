// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import dayjs from "dayjs";
import { Logger } from "./types";

const nowDate = () => dayjs().format('YYYY/MM/DD HH:mm:ss.SSS');

/**
 * Create a console logger
 * @param prefix - Optional prefix
 * @returns The logger
 */
export const createConsoleLogger = (prefix?: string) : Logger => {
  return prefix ? {
    debug: msg => console.debug(`[${prefix}]: [${nowDate()}]: debug: ${msg}`),
    info: msg => console.info(`[${prefix}]: [${nowDate()}]: ${msg}`),
    warn: msg =>console.warn(`[${prefix}]: [${nowDate()}]: warning: ${msg}`),
    error: msg =>console.error(`[${prefix}]: [${nowDate()}]: error: ${msg}`)
  } : {
    debug: msg => console.debug(`[${nowDate()}]: ${msg}`),
    info: msg => console.info(`[${nowDate()}]: ${msg}`),
    warn: msg => console.warn(`[${nowDate()}]: ${msg}`),
    error: msg => console.error(`[${nowDate()}]: ${msg}`),
  };
};
