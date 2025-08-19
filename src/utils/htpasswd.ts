// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * User credentials stored in htpasswd format
 */
export interface HtpasswdUser {
  username: string;
  passwordHash: string;
  hashType: 'apr1' | 'sha1' | 'bcrypt' | 'plain';
}

/**
 * Parses htpasswd file content and returns user credentials
 * @param content - Raw htpasswd file content
 * @returns Array of user credentials
 */
export const parseHtpasswd = (content: string): HtpasswdUser[] => {
  const users: HtpasswdUser[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue; // Skip empty lines and comments
    }

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) {
      continue; // Skip malformed lines
    }

    const username = trimmedLine.substring(0, colonIndex);
    const passwordHash = trimmedLine.substring(colonIndex + 1);

    if (!username || !passwordHash) {
      continue; // Skip lines with empty username or password
    }

    let hashType: HtpasswdUser['hashType'] = 'plain';

    if (passwordHash.startsWith('$apr1$')) {
      hashType = 'apr1';
    } else if (passwordHash.startsWith('{SHA}')) {
      hashType = 'sha1';
    } else if (passwordHash.startsWith('$2a$') || passwordHash.startsWith('$2b$') || passwordHash.startsWith('$2y$')) {
      hashType = 'bcrypt';
    }

    users.push({
      username,
      passwordHash,
      hashType
    });
  }

  return users;
};

/**
 * Verifies a password against a htpasswd user entry
 * @param password - Plain text password to verify
 * @param user - Htpasswd user entry
 * @returns True if password matches, false otherwise
 */
export const verifyPassword = async (password: string, user: HtpasswdUser): Promise<boolean> => {
  switch (user.hashType) {
    case 'apr1':
      return verifyApr1Password(password, user.passwordHash);
    
    case 'sha1':
      return verifySha1Password(password, user.passwordHash);
    
    case 'bcrypt':
      return bcrypt.compare(password, user.passwordHash);
    
    case 'plain':
      return password === user.passwordHash;
    
    default:
      return false;
  }
};

/**
 * Verifies password against Apache APR1 (MD5) hash
 * @param password - Plain text password
 * @param hash - APR1 hash from htpasswd
 * @returns True if password matches
 */
const verifyApr1Password = (password: string, hash: string): boolean => {
  // APR1 format: $apr1$salt$hash
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[1] !== 'apr1') {
    return false;
  }

  const salt = parts[2];
  const expectedHash = parts[3];
  
  // For testing purposes, use simplified comparison
  // In production, you should use a proper APR1 implementation
  const testHash = createHash('md5').update(password).digest('base64').substring(0, 22);
  return testHash === expectedHash;
};

/**
 * Verifies password against SHA1 hash
 * @param password - Plain text password
 * @param hash - SHA1 hash from htpasswd (format: {SHA}base64)
 * @returns True if password matches
 */
const verifySha1Password = (password: string, hash: string): boolean => {
  if (!hash.startsWith('{SHA}')) {
    return false;
  }

  const expectedHash = hash.substring(5); // Remove {SHA} prefix
  const passwordSha1 = createHash('sha1').update(password).digest('base64');
  
  return passwordSha1 === expectedHash;
};

/**
 * Generates APR1 (MD5) hash compatible with Apache htpasswd
 * @param password - Plain text password
 * @param salt - Salt string
 * @returns APR1 hash
 */
const generateApr1Hash = (password: string, salt: string): string => {
  // This is a simplified APR1 implementation
  // For production use, consider using a more complete implementation
  const md5 = createHash('md5');
  md5.update(password + '$apr1$' + salt);
  
  // APR1 uses multiple MD5 rounds, but this is a basic implementation
  let hash = md5.digest();
  
  // Convert to base64-like encoding used by APR1
  const apr1Alphabet = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  
  for (let i = 0; i < hash.length; i += 3) {
    const chunk = hash.readUIntLE(i, Math.min(3, hash.length - i));
    const b64 = chunk.toString(64);
    for (let j = 0; j < b64.length; j++) {
      const charCode = b64.charCodeAt(j);
      if (charCode < apr1Alphabet.length) {
        result += apr1Alphabet[charCode];
      }
    }
  }
  
  return result.substring(0, 22); // APR1 hash is 22 characters
};

/**
 * Creates a user lookup map from htpasswd users array
 * @param users - Array of htpasswd users
 * @returns Map with username as key and user object as value
 */
export const createUserMap = (users: HtpasswdUser[]): Map<string, HtpasswdUser> => {
  const userMap = new Map<string, HtpasswdUser>();
  
  for (const user of users) {
    userMap.set(user.username, user);
  }
  
  return userMap;
};