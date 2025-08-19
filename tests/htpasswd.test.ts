// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect } from 'vitest';
import { parseHtpasswd, verifyPassword, createUserMap } from '../src/utils/htpasswd';

describe('htpasswd parser', () => {
  describe('parseHtpasswd', () => {
    it('should parse simple htpasswd content', () => {
      const content = `user1:password123
user2:{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=
user3:$apr1$salt$hash
admin:$2a$10$hash`;

      const users = parseHtpasswd(content);
      
      expect(users).toHaveLength(4);
      expect(users[0]).toEqual({
        username: 'user1',
        passwordHash: 'password123',
        hashType: 'plain'
      });
      expect(users[1]).toEqual({
        username: 'user2',
        passwordHash: '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=',
        hashType: 'sha1'
      });
      expect(users[2]).toEqual({
        username: 'user3',
        passwordHash: '$apr1$salt$hash',
        hashType: 'apr1'
      });
      expect(users[3]).toEqual({
        username: 'admin',
        passwordHash: '$2a$10$hash',
        hashType: 'bcrypt'
      });
    });

    it('should skip empty lines and comments', () => {
      const content = `# This is a comment
user1:password123

# Another comment
user2:password456
`;

      const users = parseHtpasswd(content);
      
      expect(users).toHaveLength(2);
      expect(users[0].username).toBe('user1');
      expect(users[1].username).toBe('user2');
    });

    it('should skip malformed lines', () => {
      const content = `user1:password123
malformed-line-without-colon
:empty-username
user2:
user3:password456`;

      const users = parseHtpasswd(content);
      
      expect(users).toHaveLength(2);
      expect(users[0].username).toBe('user1');
      expect(users[1].username).toBe('user3');
    });

    it('should detect different hash types correctly', () => {
      const content = `plain:password
sha1:{SHA}base64hash
apr1:$apr1$salt$hash
bcrypt2a:$2a$10$hash
bcrypt2b:$2b$12$hash
bcrypt2y:$2y$10$hash`;

      const users = parseHtpasswd(content);
      
      expect(users).toHaveLength(6);
      expect(users[0].hashType).toBe('plain');
      expect(users[1].hashType).toBe('sha1');
      expect(users[2].hashType).toBe('apr1');
      expect(users[3].hashType).toBe('bcrypt');
      expect(users[4].hashType).toBe('bcrypt');
      expect(users[5].hashType).toBe('bcrypt');
    });
  });

  describe('verifyPassword', () => {
    it('should verify plain text passwords', async () => {
      const user = {
        username: 'test',
        passwordHash: 'password123',
        hashType: 'plain' as const
      };

      expect(await verifyPassword('password123', user)).toBe(true);
      expect(await verifyPassword('wrong', user)).toBe(false);
    });

    it('should verify SHA1 passwords', async () => {
      // SHA1 hash of "password"
      const user = {
        username: 'test',
        passwordHash: '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=',
        hashType: 'sha1' as const
      };

      expect(await verifyPassword('password', user)).toBe(true);
      expect(await verifyPassword('wrong', user)).toBe(false);
    });

    it('should handle invalid SHA1 format', async () => {
      const user = {
        username: 'test',
        passwordHash: 'invalid-sha1',
        hashType: 'sha1' as const
      };

      expect(await verifyPassword('password', user)).toBe(false);
    });

    it('should verify bcrypt passwords', async () => {
      // This is a bcrypt hash for "password"
      const user = {
        username: 'test',
        passwordHash: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        hashType: 'bcrypt' as const
      };

      expect(await verifyPassword('password', user)).toBe(true);
      expect(await verifyPassword('wrong', user)).toBe(false);
    });

    it('should return false for unknown hash types', async () => {
      const user = {
        username: 'test',
        passwordHash: 'hash',
        hashType: 'unknown' as any
      };

      expect(await verifyPassword('password', user)).toBe(false);
    });
  });

  describe('createUserMap', () => {
    it('should create a user map from users array', () => {
      const users = [
        {
          username: 'user1',
          passwordHash: 'hash1',
          hashType: 'plain' as const
        },
        {
          username: 'user2',
          passwordHash: 'hash2',
          hashType: 'sha1' as const
        }
      ];

      const userMap = createUserMap(users);
      
      expect(userMap.size).toBe(2);
      expect(userMap.get('user1')).toEqual(users[0]);
      expect(userMap.get('user2')).toEqual(users[1]);
      expect(userMap.get('nonexistent')).toBeUndefined();
    });

    it('should handle empty users array', () => {
      const userMap = createUserMap([]);
      
      expect(userMap.size).toBe(0);
    });

    it('should overwrite duplicate usernames', () => {
      const users = [
        {
          username: 'user1',
          passwordHash: 'hash1',
          hashType: 'plain' as const
        },
        {
          username: 'user1',
          passwordHash: 'hash2',
          hashType: 'sha1' as const
        }
      ];

      const userMap = createUserMap(users);
      
      expect(userMap.size).toBe(1);
      expect(userMap.get('user1')?.passwordHash).toBe('hash2');
      expect(userMap.get('user1')?.hashType).toBe('sha1');
    });
  });
});