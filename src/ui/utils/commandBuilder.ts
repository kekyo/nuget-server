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
  apiPassword?: string;
}

/**
 * Build a dotnet nuget add source command with the given options
 */
export const buildAddSourceCommand = (options: CommandOptions): string => {
  const { serverUrl, sourceName = "ref1", username, apiPassword } = options;

  // Build the URL
  const url = serverUrl.baseUrl
    ? `${serverUrl.baseUrl}/v3/index.json`
    : `http://localhost:${serverUrl.port}/v3/index.json`;

  // Start building the command
  let command = `dotnet nuget add source "${url}" -n "${sourceName}"`;

  // Add authentication if provided
  if (username && apiPassword) {
    command += ` -u ${username} -p ${apiPassword} --store-password-in-clear-text`;
  }

  // Add insecure connection flag if needed
  const isInsecure = serverUrl.baseUrl
    ? !serverUrl.baseUrl.startsWith("https:")
    : true;
  if (isInsecure) {
    command += " --allow-insecure-connections";
  }

  return command;
};

/**
 * Build a curl command for publishing packages
 */
export const buildPublishCommand = (options: CommandOptions): string => {
  const { serverUrl, username, apiPassword } = options;

  // Build the URL
  const url = serverUrl.baseUrl
    ? `${serverUrl.baseUrl}/api/publish`
    : `http://localhost:${serverUrl.port}/api/publish`;

  // Build curl command
  let command = `curl -X POST ${url}`;

  // Add authentication if provided
  if (username && apiPassword) {
    command += ` \\\n  -u ${username}:${apiPassword}`;
  }

  command += ` \\\n  --data-binary @MyPackage.1.0.0.nupkg \\\n  -H "Content-Type: application/octet-stream"`;

  return command;
};
