// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import dayjs from "dayjs";
import { Logger, LogLevel } from "./types";

const nowDate = () => dayjs().format('YYYY/MM/DD HH:mm:ss.SSS');

const logLevelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  ignore: 4
};

/**
 * Create a console logger with log level filtering
 * @param prefix - Optional prefix
 * @param logLevel - Log level to filter messages (default: 'info')
 * @returns The logger
 */
export const createConsoleLogger = (prefix?: string, logLevel: LogLevel = 'info') : Logger => {
  const currentLogLevel = logLevelPriority[logLevel];
  
  const shouldLog = (level: LogLevel): boolean => {
    return logLevelPriority[level] >= currentLogLevel;
  };

  const noop = () => {};

  return prefix ? {
    debug: shouldLog('debug') ? msg => console.debug(`[${prefix}]: [${nowDate()}]: [debug]: ${msg}`) : noop,
    info: shouldLog('info') ? msg => console.info(`[${prefix}]: [${nowDate()}]: [info]: ${msg}`) : noop,
    warn: shouldLog('warn') ? msg =>console.warn(`[${prefix}]: [${nowDate()}]: [warning]: ${msg}`) : noop,
    error: shouldLog('error') ? msg =>console.error(`[${prefix}]: [${nowDate()}]: [error]: ${msg}`) : noop
  } : {
    debug: shouldLog('debug') ? msg => console.debug(`[${nowDate()}]: [debug]: ${msg}`) : noop,
    info: shouldLog('info') ? msg => console.info(`[${nowDate()}]: [info]: ${msg}`) : noop,
    warn: shouldLog('warn') ? msg => console.warn(`[${nowDate()}]: [warning]: ${msg}`) : noop,
    error: shouldLog('error') ? msg => console.error(`[${nowDate()}]: [error]: ${msg}`) : noop,
  };
};
