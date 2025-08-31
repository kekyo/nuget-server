import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfigFromFile } from "../src/utils/configLoader";
import { createTestDirectory } from "./helpers/test-helper";
import { writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";

describe("config-loader", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDirectory("config-loader", "test");
  });

  it("should return empty object when config.json does not exist", async () => {
    const config = await loadConfigFromFile(testDir);
    expect(config).toEqual({});
  });

  it("should load valid config.json", async () => {
    const configData = {
      port: 8080,
      baseUrl: "http://example.com",
      packageDir: "./my-packages",
      realm: "My NuGet Server",
      logLevel: "debug",
      trustedProxies: ["192.168.1.1", "10.0.0.1"],
      authMode: "publish",
      sessionSecret: "test-secret",
    };

    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify(configData, null, 2),
    );

    const config = await loadConfigFromFile(testDir);
    // packageDir is now resolved to absolute path
    expect(config).toEqual({
      ...configData,
      packageDir: resolve(testDir, "./my-packages"),
    });
  });

  it("should validate and skip invalid fields", async () => {
    const configData = {
      port: "invalid-port", // invalid type
      baseUrl: "http://example.com",
      logLevel: "invalid-level", // invalid value
      authMode: "invalid-mode", // invalid value
      trustedProxies: ["192.168.1.1", 123, "10.0.0.1"], // mixed types
    };

    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify(configData, null, 2),
    );

    const config = await loadConfigFromFile(testDir);
    expect(config).toEqual({
      baseUrl: "http://example.com",
      trustedProxies: ["192.168.1.1", "10.0.0.1"], // only valid strings
    });
  });

  it("should handle invalid JSON gracefully", async () => {
    await writeFile(join(testDir, "config.json"), "{ invalid json");

    const config = await loadConfigFromFile(testDir);
    expect(config).toEqual({});
  });

  it("should validate port range", async () => {
    const testCases = [
      { port: 0, expected: {} }, // too low
      { port: -1, expected: {} }, // negative
      { port: 65536, expected: {} }, // too high
      { port: 1, expected: { port: 1 } }, // valid minimum
      { port: 65535, expected: { port: 65535 } }, // valid maximum
      { port: 8080, expected: { port: 8080 } }, // valid normal
    ];

    for (const testCase of testCases) {
      await writeFile(
        join(testDir, "config.json"),
        JSON.stringify({ port: testCase.port }),
      );
      const config = await loadConfigFromFile(testDir);
      expect(config).toEqual(testCase.expected);
    }
  });

  it("should validate logLevel values", async () => {
    const validLevels = ["debug", "info", "warn", "error", "ignore"];

    for (const level of validLevels) {
      await writeFile(
        join(testDir, "config.json"),
        JSON.stringify({ logLevel: level }),
      );
      const config = await loadConfigFromFile(testDir);
      expect(config.logLevel).toBe(level);
    }

    // Invalid level
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({ logLevel: "verbose" }),
    );
    const config = await loadConfigFromFile(testDir);
    expect(config.logLevel).toBeUndefined();
  });

  it("should validate authMode values", async () => {
    const validModes = ["none", "publish", "full"];

    for (const mode of validModes) {
      await writeFile(
        join(testDir, "config.json"),
        JSON.stringify({ authMode: mode }),
      );
      const config = await loadConfigFromFile(testDir);
      expect(config.authMode).toBe(mode);
    }

    // Invalid mode
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({ authMode: "custom" }),
    );
    const config = await loadConfigFromFile(testDir);
    expect(config.authMode).toBeUndefined();
  });

  it("should handle file permission errors gracefully", async () => {
    // Create a subdirectory with config.json as a directory to trigger an error
    const subDir = join(testDir, "subdir");
    await mkdir(subDir, { recursive: true });
    await mkdir(join(subDir, "config.json"), { recursive: true });

    const config = await loadConfigFromFile(subDir);
    expect(config).toEqual({});
  });

  it("should filter non-string values from trustedProxies", async () => {
    const configData = {
      trustedProxies: [
        "192.168.1.1",
        null,
        123,
        "10.0.0.1",
        undefined,
        true,
        "172.16.0.1",
      ],
    };

    await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

    const config = await loadConfigFromFile(testDir);
    expect(config.trustedProxies).toEqual([
      "192.168.1.1",
      "10.0.0.1",
      "172.16.0.1",
    ]);
  });

  it("should handle partial config files", async () => {
    const configData = {
      port: 3000,
      baseUrl: "http://localhost:3000",
      // Other fields omitted
    };

    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify(configData, null, 2),
    );

    const config = await loadConfigFromFile(testDir);
    expect(config).toEqual({
      port: 3000,
      baseUrl: "http://localhost:3000",
    });
    expect(config.packageDir).toBeUndefined();
    expect(config.authMode).toBeUndefined();
  });

  describe("packageDir path resolution", () => {
    it("should resolve relative packageDir from config directory", async () => {
      const configData = {
        packageDir: "./packages",
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.packageDir).toBe(resolve(testDir, "./packages"));
    });

    it("should resolve parent relative packageDir from config directory", async () => {
      const configData = {
        packageDir: "../packages",
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.packageDir).toBe(resolve(testDir, "../packages"));
    });

    it("should preserve absolute packageDir path", async () => {
      const absolutePath = "/absolute/path/to/packages";
      const configData = {
        packageDir: absolutePath,
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.packageDir).toBe(absolutePath);
    });

    it("should resolve complex relative packageDir path", async () => {
      const configData = {
        packageDir: "./subdir/../packages",
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.packageDir).toBe(resolve(testDir, "./subdir/../packages"));
      // This should normalize to testDir/packages
      expect(config.packageDir).toBe(join(testDir, "packages"));
    });

    it("should handle Windows-style absolute paths", async () => {
      // This test only makes sense on Windows, but we can still verify the behavior
      const windowsPath = "C:\\Users\\test\\packages";
      const configData = {
        packageDir: windowsPath,
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      // On Windows, this would remain as-is
      // On Unix, path.resolve would still handle it properly
      expect(config.packageDir).toBeDefined();
    });
  });

  describe("usersFile path resolution", () => {
    it("should resolve relative usersFile from config directory", async () => {
      const configData = {
        usersFile: "./users.json",
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.usersFile).toBe(resolve(testDir, "./users.json"));
    });

    it("should resolve parent relative usersFile from config directory", async () => {
      const configData = {
        usersFile: "../data/users.json",
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.usersFile).toBe(resolve(testDir, "../data/users.json"));
    });

    it("should preserve absolute usersFile path", async () => {
      const absolutePath = "/absolute/path/to/users.json";
      const configData = {
        usersFile: absolutePath,
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.usersFile).toBe(absolutePath);
    });

    it("should resolve complex relative usersFile path", async () => {
      const configData = {
        usersFile: "./config/../data/users.json",
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.usersFile).toBe(
        resolve(testDir, "./config/../data/users.json"),
      );
      // This should normalize to testDir/data/users.json
      expect(config.usersFile).toBe(join(testDir, "data", "users.json"));
    });

    it("should handle both packageDir and usersFile in same config", async () => {
      const configData = {
        packageDir: "./packages",
        usersFile: "./data/users.json",
      };

      await writeFile(join(testDir, "config.json"), JSON.stringify(configData));

      const config = await loadConfigFromFile(testDir);
      expect(config.packageDir).toBe(resolve(testDir, "./packages"));
      expect(config.usersFile).toBe(resolve(testDir, "./data/users.json"));
    });
  });
});
