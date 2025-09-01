// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect } from "vitest";
import {
  buildAddSourceCommand,
  buildPublishCommand,
  CommandOptions,
} from "../src/ui/utils/commandBuilder";

describe("commandBuilder", () => {
  describe("buildAddSourceCommand", () => {
    it("should build command with HTTP URL when isHttps is false and no baseUrl", () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain("http://localhost:5000/v3/index.json");
      expect(command).toContain("--allow-insecure-connections");
      expect(command).toContain('-n "ref1"');
      expect(command).toContain("--protocol-version 3");
    });

    it("should build command with HTTPS URL when isHttps is true and no baseUrl", () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain("https://localhost:5443/v3/index.json");
      expect(command).not.toContain("--allow-insecure-connections");
      expect(command).toContain('-n "ref1"');
      expect(command).toContain("--protocol-version 3");
    });

    it("should use baseUrl when provided with HTTP", () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: "http://nuget.example.com",
          port: 5000,
          isHttps: false,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('"http://nuget.example.com/v3/index.json"');
      expect(command).toContain("--allow-insecure-connections");
    });

    it("should use baseUrl when provided with HTTPS", () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: "https://nuget.example.com",
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('"https://nuget.example.com/v3/index.json"');
      expect(command).not.toContain("--allow-insecure-connections");
    });

    it("should include authentication when username and apiPassword are provided", () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
        username: "testuser",
        apiPassword: "test-api-password",
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain("-u testuser");
      expect(command).toContain("-p test-api-password");
      expect(command).toContain("--store-password-in-clear-text");
    });

    it("should use custom source name when provided", () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
        sourceName: "my-nuget-server",
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('-n "my-nuget-server"');
      expect(command).not.toContain('-n "ref1"');
    });

    it("should handle baseUrl with path prefix", () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: "https://example.com/nuget",
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildAddSourceCommand(options);

      expect(command).toContain('"https://example.com/nuget/v3/index.json"');
      expect(command).not.toContain("--allow-insecure-connections");
    });
  });

  describe("buildPublishCommand", () => {
    it("should build curl command with HTTP URL when isHttps is false and no baseUrl", () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        "curl -X POST http://localhost:5000/api/publish",
      );
      expect(command).toContain("--data-binary @MyPackage.1.0.0.nupkg");
      expect(command).toContain('-H "Content-Type: application/octet-stream"');
    });

    it("should build curl command with HTTPS URL when isHttps is true and no baseUrl", () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        "curl -X POST https://localhost:5443/api/publish",
      );
      expect(command).toContain("--data-binary @MyPackage.1.0.0.nupkg");
      expect(command).toContain('-H "Content-Type: application/octet-stream"');
    });

    it("should use baseUrl when provided with HTTP", () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: "http://nuget.example.com",
          port: 5000,
          isHttps: false,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        "curl -X POST http://nuget.example.com/api/publish",
      );
    });

    it("should use baseUrl when provided with HTTPS", () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: "https://nuget.example.com",
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        "curl -X POST https://nuget.example.com/api/publish",
      );
    });

    it("should include authentication when username and apiPassword are provided", () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
        username: "testuser",
        apiPassword: "test-api-password",
      };

      const command = buildPublishCommand(options);

      expect(command).toContain("-u testuser:test-api-password");
    });

    it("should handle baseUrl with path prefix", () => {
      const options: CommandOptions = {
        serverUrl: {
          baseUrl: "https://example.com/nuget",
          port: 5443,
          isHttps: true,
        },
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        "curl -X POST https://example.com/nuget/api/publish",
      );
    });

    it("should format command with line breaks for readability", () => {
      const options: CommandOptions = {
        serverUrl: {
          port: 5000,
          isHttps: false,
        },
        username: "testuser",
        apiPassword: "test-api-password",
      };

      const command = buildPublishCommand(options);

      expect(command).toContain(
        "curl -X POST http://localhost:5000/api/publish",
      );
      expect(command).toContain(" \\\n  -u testuser:test-api-password");
      expect(command).toContain(" \\\n  --data-binary @MyPackage.1.0.0.nupkg");
      expect(command).toContain(
        ' \\\n  -H "Content-Type: application/octet-stream"',
      );
    });
  });
});
