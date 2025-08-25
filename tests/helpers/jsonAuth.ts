import { promises as fs } from 'fs';
import path from 'path';
import { generateSalt, hashPassword, generateApiKey, generateUserId } from '../../src/utils/crypto';

export interface JsonUser {
  username: string;
  password: string;
  role: 'read' | 'publish' | 'admin';
}

/**
 * Creates a users.json file with the specified users
 * @param configDir - Directory where the users.json file should be created
 * @param users - Array of users to include in the file
 */
export const createUsersJsonFile = async (
  configDir: string,
  users: JsonUser[]
): Promise<void> => {
  const usersData = users.map(user => {
    const passwordSalt = generateSalt();
    const passwordHash = hashPassword(user.password, passwordSalt);
    
    const apiKey = generateApiKey();
    const apiKeySalt = generateSalt();
    const apiKeyHash = hashPassword(apiKey, apiKeySalt);

    const now = new Date().toISOString();
    
    return {
      id: generateUserId(),
      username: user.username,
      passwordHash,
      salt: passwordSalt,
      apiKeyHash,
      apiKeySalt,
      role: user.role,
      createdAt: now,
      updatedAt: now
    };
  });

  const filePath = path.join(configDir, 'users.json');
  await fs.writeFile(filePath, JSON.stringify(usersData, null, 2));
};

/**
 * Deletes the users.json file
 * @param configDir - Directory containing the users.json file
 */
export const deleteUsersJsonFile = async (configDir: string): Promise<void> => {
  const filePath = path.join(configDir, 'users.json');
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore if file doesn't exist
  }
};

/**
 * Reads and parses the users.json file
 * @param configDir - Directory containing the users.json file
 * @returns Array of user objects
 */
export const readUsersJsonFile = async (configDir: string): Promise<any[]> => {
  const filePath = path.join(configDir, 'users.json');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return [];
  }
};

/**
 * Checks if the users.json file exists
 * @param configDir - Directory containing the users.json file
 * @returns True if file exists
 */
export const usersJsonFileExists = async (configDir: string): Promise<boolean> => {
  const filePath = path.join(configDir, 'users.json');
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Creates a user via the API and returns the API key
 * @param serverUrl - Base server URL
 * @param adminAuth - Admin authentication credentials
 * @param userRequest - User creation request
 * @returns API key for the created user
 */
export const createUserViaApi = async (
  serverUrl: string,
  adminAuth: string,
  userRequest: { username: string; password: string; role: string }
): Promise<string> => {
  const response = await fetch(`${serverUrl}/api/useradd`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(adminAuth).toString('base64')}`
    },
    body: JSON.stringify(userRequest)
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create user: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.apiKey;
};

/**
 * Makes an HTTP request with Basic authentication using API key
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 */
export const makeApiKeyAuthenticatedRequest = async (
  url: string,
  options: {
    method?: string;
    username?: string;
    apiKey?: string;
    body?: Buffer | Uint8Array | string | object;
    headers?: Record<string, string>;
  } = {}
): Promise<Response> => {
  const { method = 'GET', username, apiKey, body, headers = {} } = options;
  
  if (username && apiKey) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`;
  }
  
  let requestBody: Uint8Array | string | undefined;
  
  if (body) {
    if (typeof body === 'object' && !(body instanceof Buffer) && !(body instanceof Uint8Array)) {
      // JSON object
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    } else if (typeof body === 'string') {
      // String body
      headers['Content-Type'] = headers['Content-Type'] || 'text/plain';
      requestBody = body;
    } else {
      // Buffer or Uint8Array
      headers['Content-Type'] = headers['Content-Type'] || 'application/octet-stream';
      requestBody = body instanceof Buffer ? new Uint8Array(body) : body;
    }
  }
  
  return fetch(url, {
    method,
    headers,
    body: requestBody
  });
};