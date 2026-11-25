// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Identifies the canonical, untagged Base64 encoding used in older user stores.
 * @param hash - Stored password or API password hash.
 * @returns Whether the record contains a legacy 20-byte digest.
 */
export const isLegacyCredentialHash = (hash: string): boolean =>
  typeof hash === 'string' &&
  /^[A-Za-z0-9+/]{27}=$/.test(hash) &&
  Buffer.from(hash, 'base64').toString('base64') === hash;

/**
 * Verifies an existing salted SHA-1 record during the migration period.
 * @param value - Password or API password presented by its holder.
 * @param hash - Stored legacy digest.
 * @param salt - The original salt string, as written by older releases.
 * @returns Whether this credential matches a supported legacy record.
 * @remarks This compatibility reader never creates credentials. Its callers
 * replace a verified record before returning authentication success.
 */
export const matchesLegacyCredential = (
  value: string,
  hash: string,
  salt: string | undefined
): boolean => {
  if (
    !isLegacyCredentialHash(hash) ||
    typeof salt !== 'string' ||
    salt.length === 0
  )
    return false;
  const candidate = createHash('sha1')
    .update(value + salt, 'utf8')
    .digest();
  return timingSafeEqual(candidate, Buffer.from(hash, 'base64'));
};
