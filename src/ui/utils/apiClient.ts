// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Extracts the path prefix from a base URL
 * @param baseUrl - The base URL to extract from
 * @returns The path prefix (e.g., "/nuget") or empty string
 */
export const getPathPrefix = (baseUrl?: string): string => {
  if (!baseUrl) return "";

  try {
    const url = new URL(baseUrl);
    // Remove trailing slash
    return url.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
};

/**
 * Creates an API URL with the correct path prefix
 * @param path - The API path (e.g., "/api/config")
 * @param baseUrl - Optional base URL to extract prefix from
 * @returns The full API path with prefix if needed
 */
export const createApiUrl = (path: string, baseUrl?: string): string => {
  const prefix = getPathPrefix(baseUrl);
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${normalizedPath}`;
};

// Global storage for the base URL path prefix
let globalPathPrefix: string = "";

/**
 * Sets the global path prefix for all API calls
 * @param baseUrl - The base URL to extract prefix from
 */
export const setGlobalPathPrefix = (baseUrl?: string): void => {
  globalPathPrefix = getPathPrefix(baseUrl);
};

/**
 * Gets the current global path prefix
 * @returns The global path prefix
 */
export const getGlobalPathPrefix = (): string => {
  return globalPathPrefix;
};

/**
 * Wrapper for fetch that automatically adds the path prefix
 * @param path - The API path (e.g., "/api/config")
 * @param options - Fetch options
 * @param baseUrl - Optional base URL to extract prefix from
 * @returns Promise with the fetch response
 */
export const apiFetch = (
  path: string,
  options?: RequestInit,
  baseUrl?: string,
): Promise<Response> => {
  // Use provided baseUrl or fall back to global prefix
  const url =
    baseUrl !== undefined
      ? createApiUrl(path, baseUrl)
      : `${globalPathPrefix}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, options);
};
