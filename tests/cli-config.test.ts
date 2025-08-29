import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import { createTestDirectory, getTestPort } from "./helpers/test-helper";
import { writeFile } from "fs/promises";
import { join } from "path";

const execAsync = promisify(exec);

describe("CLI configuration priority", () => {
  let testDir: string;
  let testPort: number;
  const cliPath = join(process.cwd(), "dist", "cli.js");

  beforeEach(async (fn) => {
    testDir = await createTestDirectory("cli-config", fn.task.name);
    testPort = getTestPort(6200);
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.NUGET_SERVER_PORT;
    delete process.env.NUGET_SERVER_PACKAGE_DIR;
    delete process.env.NUGET_SERVER_LOG_LEVEL;
    delete process.env.NUGET_SERVER_AUTH_MODE;
  });

  const runCli = async (
    args: string = "",
    env: Record<string, string> = {},
  ): Promise<{ stdout: string; stderr: string }> => {
    // Merge environment variables with current process env
    const fullEnv = { ...process.env, ...env };

    // Run with timeout to prevent hanging - increased to 5 seconds for slower systems
    const command = `timeout 5 node ${cliPath} ${args} || true`;
    return execAsync(command, { env: fullEnv });
  };

  it("should use CLI options as highest priority", async () => {
    // Create config.json
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({
        port: 9000,
        logLevel: "debug",
        authMode: "full",
      }),
    );

    // Set environment variables
    const env = {
      NUGET_SERVER_PORT: "8000",
      NUGET_SERVER_LOG_LEVEL: "warn",
      NUGET_SERVER_AUTH_MODE: "publish",
    };

    // Run with CLI options
    const { stdout } = await runCli(
      `--port ${testPort} --log-level info --auth-mode none -c ${testDir}`,
      env,
    );

    // CLI options should take precedence
    expect(stdout).toContain(`Port: ${testPort}`);
    expect(stdout).toContain("Log level: info");
    expect(stdout).toContain("Authentication mode: none");
  }, 10000);

  it("should use environment variables when CLI options not provided", async () => {
    // Create config.json
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({
        port: 9000,
        packageDir: "./config-packages",
        authMode: "full",
      }),
    );

    // Set environment variables
    const env = {
      NUGET_SERVER_PORT: String(testPort),
      NUGET_SERVER_PACKAGE_DIR: "./env-packages",
      NUGET_SERVER_AUTH_MODE: "publish",
    };

    // Run without CLI options (except config dir)
    const { stdout } = await runCli(`-c ${testDir}`, env);

    // Environment variables should take precedence over config.json
    expect(stdout).toContain(`Port: ${testPort}`);
    expect(stdout).toContain("Package directory: ./env-packages");
    expect(stdout).toContain("Authentication mode: publish");
  }, 10000);

  it("should use config.json when CLI and env not provided", async () => {
    // Create config.json
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({
        port: testPort,
        packageDir: "./json-packages",
        logLevel: "debug",
        authMode: "publish",
      }),
    );

    // Run without CLI options or environment variables
    const { stdout, stderr } = await runCli(`-c ${testDir}`);

    // Check if there's any output
    const output = stdout || stderr;

    // config.json values should be used
    expect(output).toContain(`Port: ${testPort}`);
    expect(output).toContain("Package directory: ./json-packages");
    expect(output).toContain("Log level: debug");
    expect(output).toContain("Authentication mode: publish");
    expect(output).toContain(
      `Loaded configuration from ${testDir}/config.json`,
    );
  }, 10000);

  it("should use defaults when nothing is provided", async () => {
    // Run without any configuration
    const { stdout, stderr } = await runCli(`-c ${testDir}`);

    // Check if there's any output
    const output = stdout || stderr;

    // Default values should be used
    expect(output).toContain("Port: 5963");
    expect(output).toContain("Package directory: ./packages");
    expect(output).toContain("Log level: info");
    expect(output).toContain("Authentication mode: none");
  }, 10000);

  it("should handle mixed configuration sources", async () => {
    // Create config.json with some values
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({
        logLevel: "debug",
        realm: "Config Realm",
        trustedProxies: ["192.168.1.1"],
      }),
    );

    // Set some environment variables
    const env = {
      NUGET_SERVER_PORT: String(testPort),
      NUGET_SERVER_AUTH_MODE: "publish",
    };

    // Run with some CLI options
    const { stdout } = await runCli(
      `--package-dir ./cli-packages -c ${testDir}`,
      env,
    );

    // Mixed sources
    expect(stdout).toContain(`Port: ${testPort}`); // from env
    expect(stdout).toContain("Package directory: ./cli-packages"); // from CLI
    expect(stdout).toContain("Log level: debug"); // from config.json
    expect(stdout).toContain("Authentication mode: publish"); // from env
    expect(stdout).toContain("Realm: Config Realm"); // from config.json
    expect(stdout).toContain("Trusted proxies: 192.168.1.1"); // from config.json
  }, 10000);

  it("should handle array trustedProxies from config.json", async () => {
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({
        port: testPort,
        trustedProxies: ["192.168.1.1", "10.0.0.1", "::1"],
      }),
    );

    const { stdout } = await runCli(`-c ${testDir}`);
    expect(stdout).toContain("Trusted proxies: 192.168.1.1, 10.0.0.1, ::1");
  }, 10000);

  it("should validate configuration values from all sources", async () => {
    // Create config.json with invalid values
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({
        port: testPort,
        logLevel: "invalid-level",
        authMode: "invalid-mode",
      }),
    );

    const { stdout } = await runCli(`-c ${testDir}`);

    // Invalid values should fall back to defaults
    expect(stdout).toContain(`Port: ${testPort}`); // valid from config
    expect(stdout).toContain("Log level: info"); // default (invalid in config)
    expect(stdout).toContain("Authentication mode: none"); // default (invalid in config)
  }, 10000);

  it("should handle sessionSecret from environment only", async () => {
    // sessionSecret in config.json should work but show warning
    await writeFile(
      join(testDir, "config.json"),
      JSON.stringify({
        port: testPort,
        sessionSecret: "config-secret",
      }),
    );

    const env = {
      NUGET_SERVER_SESSION_SECRET: "env-secret",
    };

    // Environment variable should take precedence
    // Note: We can't directly check sessionSecret in output, but it's used internally
    const { stdout } = await runCli(`-c ${testDir}`, env);
    expect(stdout).toContain(`Port: ${testPort}`);
  }, 10000);
});
