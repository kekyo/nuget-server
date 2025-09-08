// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

// Session handler type for managing 401 responses
let sessionExpiredHandler:
  | ((authMode: 'none' | 'publish' | 'full') => void)
  | null = null;
let currentAuthMode: 'none' | 'publish' | 'full' | null = null;

/**
 * Set the session expired handler and auth mode
 * @param handler - Function to handle session expiry
 * @param authMode - Current authentication mode
 */
export const setSessionHandler = (
  handler: (authMode: 'none' | 'publish' | 'full') => void,
  authMode: 'none' | 'publish' | 'full'
) => {
  sessionExpiredHandler = handler;
  currentAuthMode = authMode;
};

/**
 * Wrapper for fetch that uses relative paths and handles session expiry
 * This allows the app to work correctly regardless of the base path
 * @param path - The API path (e.g., "api/config")
 * @param options - Fetch options
 * @returns Promise with the fetch response
 */
export const apiFetch = async (
  path: string,
  options?: RequestInit
): Promise<Response> => {
  // Remove leading slash if present to ensure relative path
  const relativePath = path.startsWith('/') ? path.slice(1) : path;

  // Add X-Requested-With header to identify UI client requests
  // This prevents browser Basic auth popup on 401 responses
  const headers = new Headers(options?.headers);
  headers.set('X-Requested-With', 'XMLHttpRequest');

  const response = await fetch(relativePath, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized responses (session expired)
  if (response.status === 401) {
    // Don't handle 401 for login/logout endpoints
    if (!path.includes('api/auth/login') && !path.includes('api/auth/logout')) {
      // If session handler is set, use it to handle the expired session
      if (sessionExpiredHandler && currentAuthMode) {
        // Clone the response before calling handler since it might be consumed
        const clonedResponse = response.clone();
        sessionExpiredHandler(currentAuthMode);
        return clonedResponse;
      }
    }
  }

  return response;
};
