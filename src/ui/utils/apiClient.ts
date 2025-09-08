// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Wrapper for fetch that uses relative paths
 * This allows the app to work correctly regardless of the base path
 * @param path - The API path (e.g., "api/config")
 * @param options - Fetch options
 * @returns Promise with the fetch response
 */
export const apiFetch = (
  path: string,
  options?: RequestInit
): Promise<Response> => {
  // Remove leading slash if present to ensure relative path
  const relativePath = path.startsWith('/') ? path.slice(1) : path;

  // Add X-Requested-With header to identify UI client requests
  // This prevents browser Basic auth popup on 401 responses
  const headers = new Headers(options?.headers);
  headers.set('X-Requested-With', 'XMLHttpRequest');

  return fetch(relativePath, {
    ...options,
    headers,
  });
};
