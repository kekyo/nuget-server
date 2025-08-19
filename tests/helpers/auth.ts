import fs from 'fs-extra';
import path from 'path';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';

export interface HtpasswdUser {
  username: string;
  password: string;
  hashType: 'plain' | 'sha1' | 'apr1' | 'bcrypt';
}

/**
 * Creates an htpasswd file with the specified users
 * @param configDir - Directory where the htpasswd file should be created
 * @param filename - Name of the htpasswd file
 * @param users - Array of users to include in the file
 */
export const createHtpasswdFile = async (
  configDir: string,
  filename: string,
  users: HtpasswdUser[]
): Promise<void> => {
  const lines: string[] = [];
  
  for (const user of users) {
    let passwordHash: string;
    
    switch (user.hashType) {
      case 'plain':
        passwordHash = user.password;
        break;
      case 'sha1':
        passwordHash = '{SHA}' + createHash('sha1').update(user.password).digest('base64');
        break;
      case 'apr1':
        // Simplified APR1 implementation for testing - use a fixed hash for testing
        passwordHash = `$apr1$testsalt$${createHash('md5').update(user.password).digest('base64').substring(0, 22)}`;
        break;
      case 'bcrypt':
        passwordHash = bcrypt.hashSync(user.password, 10);
        break;
    }
    
    lines.push(`${user.username}:${passwordHash}`);
  }
  
  const filePath = path.join(configDir, filename);
  await fs.writeFile(filePath, lines.join('\n'));
};

/**
 * Deletes an htpasswd file
 * @param configDir - Directory containing the htpasswd file
 * @param filename - Name of the htpasswd file
 */
export const deleteHtpasswdFile = async (
  configDir: string, 
  filename: string
): Promise<void> => {
  const filePath = path.join(configDir, filename);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore if file doesn't exist
  }
};

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
    body?: Buffer | Uint8Array;
    headers?: Record<string, string>;
  } = {}
): Promise<Response> => {
  const { method = 'GET', auth, body, headers = {} } = options;
  
  if (auth) {
    headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
  }
  
  if (body) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/octet-stream';
  }
  
  // Convert Buffer to Uint8Array if needed for fetch compatibility
  const requestBody = body instanceof Buffer ? new Uint8Array(body) : body;
  
  return fetch(url, {
    method,
    headers,
    body: requestBody
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
  } = {}
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
  return new Promise(resolve => setTimeout(resolve, ms));
};