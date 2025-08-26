// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

export interface ServerUrlInfo {
  baseUrl?: string;
  port: number;
  isHttps: boolean;
}

export interface CommandOptions {
  serverUrl: ServerUrlInfo;
  sourceName?: string;
  username?: string;
  apiKey?: string;
}

/**
 * Build a dotnet nuget add source command with the given options
 */
export const buildAddSourceCommand = (options: CommandOptions): string => {
  const { serverUrl, sourceName = 'ref1', username, apiKey } = options;
  
  // Build the URL
  const url = serverUrl.baseUrl 
    ? `${serverUrl.baseUrl}/v3/index.json`
    : `http://localhost:${serverUrl.port}/v3/index.json`;
  
  // Start building the command
  let command = `dotnet nuget add source "${url}" -n "${sourceName}"`;
  
  // Add authentication if provided
  if (username && apiKey) {
    command += ` -u ${username} -p ${apiKey} --store-password-in-clear-text`;
  }
  
  // Add insecure connection flag if needed
  const isInsecure = serverUrl.baseUrl 
    ? !serverUrl.baseUrl.startsWith('https:')
    : true;
  if (isInsecure) {
    command += ' --allow-insecure-connections';
  }
  
  return command;
};