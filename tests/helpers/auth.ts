// Authentication test helpers
// Contains utility functions for testing authentication functionality

/**
 * Makes an HTTP request with Basic authentication
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 */
export const makeAuthenticatedRequest = async (
  url: string,
  options: {
    method?: string;
    auth?: string; // format: "username:password"
    body?: Buffer | Uint8Array | string | object;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> => {
  const { method = "GET", auth, body, headers = {} } = options;

  if (auth) {
    headers["Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
  }

  let requestBody: BodyInit | undefined;

  if (body) {
    if (
      typeof body === "object" &&
      !(body instanceof Buffer) &&
      !(body instanceof Uint8Array)
    ) {
      // JSON object
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body);
    } else if (typeof body === "string") {
      // String body
      headers["Content-Type"] = headers["Content-Type"] || "text/plain";
      requestBody = body;
    } else {
      // Buffer or Uint8Array - convert Buffer to Uint8Array for fetch API compatibility
      headers["Content-Type"] =
        headers["Content-Type"] || "application/octet-stream";
      // Convert Buffer to Uint8Array and cast to any to handle TypeScript's strict type checking
      // This is safe because Uint8Array is a valid BodyInit type at runtime
      requestBody = (
        body instanceof Buffer ? new Uint8Array(body) : body
      ) as any;
    }
  }

  return fetch(url, {
    method,
    headers,
    body: requestBody,
  });
};

/**
 * Makes an HTTP request with retry logic for authentication
 * @param url - Request URL
 * @param options - Request options with retry configuration
 * @returns Response object
 */
export const makeAuthenticatedRequestWithRetry = async (
  url: string,
  options: {
    method?: string;
    auth?: string; // format: "username:password"
    body?: Buffer | Uint8Array;
    headers?: Record<string, string>;
    maxRetries?: number;
    retryDelay?: number;
    expectStatus?: number; // Expected status code
  } = {},
): Promise<Response> => {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    expectStatus = 200,
    ...requestOptions
  } = options;

  let lastResponse: Response | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await makeAuthenticatedRequest(url, requestOptions);

      // If we get expected status or it's the last attempt, return response
      if (response.status === expectStatus || attempt === maxRetries) {
        return response;
      }

      lastResponse = response;

      // If unexpected status and not last attempt, wait and retry
      if (attempt < maxRetries) {
        await wait(retryDelay * attempt); // Exponential backoff
      }
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        await wait(retryDelay * attempt);
      }
    }
  }

  // Return the last response or throw the last error
  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error(`Request failed after ${maxRetries} attempts`);
};

/**
 * Waits for a specified amount of time
 * @param ms - Milliseconds to wait
 */
export const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
