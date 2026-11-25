// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createSemaphore } from 'async-primitives';
import { matchesLegacyCredential } from './legacyCredentials.ts';

/**
 * Generates a random salt for password hashing
 * @param length - Length of the salt in bytes (default: 16)
 * @returns Base64 encoded salt
 */
export const generateSalt = (length: number = 16): string => {
  return randomBytes(length).toString('base64');
};

// Parameters form part of the on-disk format. Do not accept work factors from disk.
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const passwordPrefix = 'scrypt$32768$8$3$';
const passwordWorkers = createSemaphore(2);

const derivePassword = async (
  password: string,
  salt: string
): Promise<Buffer> => {
  if (passwordWorkers.pendingCount >= 8) {
    throw Object.assign(new Error('Password processing is busy'), {
      code: 'PASSWORD_BUSY',
      statusCode: 503,
      headers: { 'Retry-After': '1' },
    });
  }
  const worker = await passwordWorkers.acquire();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 32, scryptOptions, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  } finally {
    worker.release();
  }
};

const matchesDigest = (
  stored: string,
  prefix: string,
  digest: Buffer
): boolean => {
  if (!stored.startsWith(prefix)) return false;
  const encoded = stored.slice(prefix.length);
  if (!/^[0-9a-f]{64}$/.test(encoded)) return false;
  return timingSafeEqual(digest, Buffer.from(encoded, 'hex'));
};

/**
 * Derives a versioned password hash with scrypt.
 * @param password - User-selected password.
 * @param salt - Random per-password salt.
 * @returns Encoded work factors and digest.
 */
export const hashPassword = async (
  password: string,
  salt: string
): Promise<string> =>
  passwordPrefix + (await derivePassword(password, salt)).toString('hex');

/**
 * Verifies a supported password record.
 * @param password - Submitted password.
 * @param hash - Stored, versioned password hash.
 * @param salt - Stored salt.
 * @returns Whether the password matches.
 */
export const verifyPassword = async (
  password: string,
  hash: string,
  salt: string
): Promise<boolean> =>
  typeof hash === 'string' &&
  (hash.startsWith(passwordPrefix)
    ? matchesDigest(hash, passwordPrefix, await derivePassword(password, salt))
    : matchesLegacyCredential(password, hash, salt));

/**
 * Computes a lookup digest for a randomly generated registry token.
 * @param token - Random API password presented by a NuGet client.
 * @returns SHA-256 digest.
 */
export const apiPasswordDigest = (token: string): Buffer =>
  createHash('sha256').update(token).digest();

/**
 * Encodes a token digest for storage on issuance or migration.
 * @param digest - Digest of the presented API password.
 * @returns Versioned SHA-256 token hash.
 */
export const encodeApiPasswordDigest = (digest: Buffer): string =>
  'sha256$' + digest.toString('hex');

/**
 * Checks a stored token record using a fixed-length comparison.
 * @param hash - Versioned stored token hash.
 * @param digest - Digest of the presented token.
 * @returns Whether the bearer token matches.
 */
export const matchesApiPassword = (hash: string, digest: Buffer): boolean =>
  matchesDigest(hash, 'sha256$', digest);

/**
 * Generates a secure random API password
 * @param length - Length of the API password in bytes (default: 24)
 * @returns Base64 encoded API password
 */
export const generateApiPassword = (length: number = 24): string => {
  return randomBytes(length).toString('base64');
};

/**
 * Generates a secure session token
 * @param length - Length of the token in bytes (default: 32)
 * @returns Hex encoded session token
 */
export const generateSessionToken = (length: number = 32): string => {
  return randomBytes(length).toString('hex');
};

/**
 * Generates a unique user ID
 * @returns UUID-like string
 */
export const generateUserId = (): string => {
  return randomBytes(16).toString('hex');
};
