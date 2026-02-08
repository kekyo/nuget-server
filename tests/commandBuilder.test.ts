// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect } from 'vitest';
import {
  buildAddSourceCommand,
  buildPublishCommand,
  CommandOptions,
  shouldShowAddSourceCommandInApiPasswordExamples,
  shouldShowPublishCommandInApiPasswordExamples,
  shouldShowPublishCommandInRepositoryInfo,
} from '../src/ui/utils/commandBuilder';

describe('commandBuilder', () => {
  describe('buildAddSourceCommand', () => {
    it('should build command with HTTP URL when isHttps is false and no baseUrl', () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('http://localhost:5000/v3/index.json');
      expect(command).toContain('--allow-insecure-connections');
      expect(command).toContain('-n "ref1"');
      expect(command).toContain('--protocol-version 3');
    });

    it('should build command with HTTPS URL when isHttps is true and no baseUrl', () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('https://localhost:5443/v3/index.json');
      expect(command).not.toContain('--allow-insecure-connections');
      expect(command).toContain('-n "ref1"');
      expect(command).toContain('--protocol-version 3');
    });

    it('should use baseUrl when provided with HTTP', () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: 'http://nuget.example.com',
          port: 5000,
          isHttps: false,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('"http://nuget.example.com/v3/index.json"');
      expect(command).toContain('--allow-insecure-connections');
    });

    it('should use baseUrl when provided with HTTPS', () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: 'https://nuget.example.com',
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('"https://nuget.example.com/v3/index.json"');
      expect(command).not.toContain('--allow-insecure-connections');
    });

    it('should include authentication when username and apiPassword are provided', () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
        username: 'testuser',
        apiPassword: 'test-api-password',
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('-u testuser');
      expect(command).toContain('-p test-api-password');
      expect(command).toContain('--store-password-in-clear-text');
    });

    it('should use custom source name when provided', () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
        sourceName: 'my-nuget-server',
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('-n "my-nuget-server"');
      expect(command).not.toContain('-n "ref1"');
    });

    it('should handle baseUrl with path prefix', () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: 'https://example.com/nuget',
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('"https://example.com/nuget/v3/index.json"');
      expect(command).not.toContain('--allow-insecure-connections');
    });
  });

  describe('buildPublishCommand', () => {
    it('should build curl command with HTTP URL when isHttps is false and no baseUrl', () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        'curl -X POST http://localhost:5000/api/publish'
      );
      expect(command).toContain('--data-binary @MyPackage.1.0.0.nupkg');
      expect(command).toContain('-H "Content-Type: application/octet-stream"');
    });

    it('should build curl command with HTTPS URL when isHttps is true and no baseUrl', () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        'curl -X POST https://localhost:5443/api/publish'
      );
      expect(command).toContain('--data-binary @MyPackage.1.0.0.nupkg');
      expect(command).toContain('-H "Content-Type: application/octet-stream"');
    });

    it('should use baseUrl when provided with HTTP', () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: 'http://nuget.example.com',
          port: 5000,
          isHttps: false,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        'curl -X POST http://nuget.example.com/api/publish'
      );
    });

    it('should use baseUrl when provided with HTTPS', () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: 'https://nuget.example.com',
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        'curl -X POST https://nuget.example.com/api/publish'
      );
    });

    it('should include authentication when username and apiPassword are provided', () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
        username: 'testuser',
        apiPassword: 'test-api-password',
      };

      const command = buildPublishCommand(options);

      expect(command).toContain('-u testuser:test-api-password');
    });

    it('should handle baseUrl with path prefix', () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: 'https://example.com/nuget',
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        'curl -X POST https://example.com/nuget/api/publish'
      );
    });

    it('should format command in single line', () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
        username: 'testuser',
        apiPassword: 'test-api-password',
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        'curl -X POST http://localhost:5000/api/publish'
      );
      expect(command).toContain(' -u testuser:test-api-password');
      expect(command).toContain(' --data-binary @MyPackage.1.0.0.nupkg');
      expect(command).toContain(' -H "Content-Type: application/octet-stream"');
    });
  });

  describe('shouldShowPublishCommandInRepositoryInfo', () => {
    it('should return true for none mode', () => {
      expect(shouldShowPublishCommandInRepositoryInfo('none')).toBe(true);
    });

    it('should return false for publish mode', () => {
      expect(shouldShowPublishCommandInRepositoryInfo('publish')).toBe(false);
    });

    it('should return false for full mode', () => {
      expect(shouldShowPublishCommandInRepositoryInfo('full')).toBe(false);
    });
  });

  describe('shouldShowPublishCommandInApiPasswordExamples', () => {
    it('should return false for none mode', () => {
      expect(shouldShowPublishCommandInApiPasswordExamples('none')).toBe(false);
    });

    it('should return true for publish mode', () => {
      expect(shouldShowPublishCommandInApiPasswordExamples('publish')).toBe(
        true
      );
    });

    it('should return true for full mode', () => {
      expect(shouldShowPublishCommandInApiPasswordExamples('full')).toBe(true);
    });
  });

  describe('shouldShowAddSourceCommandInApiPasswordExamples', () => {
    it('should return false for none mode', () => {
      expect(shouldShowAddSourceCommandInApiPasswordExamples('none')).toBe(
        false
      );
    });

    it('should return false for publish mode', () => {
      expect(shouldShowAddSourceCommandInApiPasswordExamples('publish')).toBe(
        false
      );
    });

    it('should return true for full mode', () => {
      expect(shouldShowAddSourceCommandInApiPasswordExamples('full')).toBe(
        true
      );
    });
  });
});
