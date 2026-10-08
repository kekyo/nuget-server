import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { TOTP } from 'otpauth';
import { createUserService } from '../src/services/userService';
import { createTestDirectory, getTestPort } from './helpers/test-helper';

describe('TOTP browser enrollment through Playwright MCP', () => {
  it('decodes the displayed QR, enrolls, recovers login, and disables TOTP', async () => {
    const directory = await createTestDirectory(
      'totp-browser',
      'QR registration and recovery'
    );
    const password = 'BrowserTotpPassword!123';
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const users = createUserService({
      configDir: directory,
      logger,
      serverConfig: { port: 5963, passwordStrengthCheck: false },
    });
    await users.initialize();
    await users.createUser({ username: 'alice', password, role: 'admin' });
    users.destroy();
    const port = await getTestPort();
    await mkdir(join(directory, 'packages'), { recursive: true });
    const configFile = join(directory, 'config.json');
    await writeFile(
      configFile,
      JSON.stringify({
        port,
        packageDir: './packages',
        usersFile: './users.json',
        authMode: 'full',
        realm: 'Browser registry',
        passwordStrengthCheck: false,
      })
    );
    const server = spawn(
      process.execPath,
      [resolve('dist/cli.mjs'), '-c', configFile],
      {
        env: {
          ...process.env,
          NUGET_SERVER_AUTH_FAILURE_DELAY_ENABLED: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    const ready = new Promise<void>((resolveReady, reject) => {
      server.on('error', reject);
      server.on('exit', () => reject(new Error(`Server stopped: ${output}`)));
      server.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('Fastify server listening')) resolveReady();
      });
      server.stderr.on('data', (data) => {
        output += data.toString();
      });
    });
    const client = new Client({ name: 'nuget-totp-tests', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve('node_modules/@playwright/mcp/cli.js'),
        '--headless',
        '--isolated',
        '--browser',
        'chromium',
        '--output-dir',
        directory,
        ...(process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH
          ? ['--executable-path', process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH]
          : []),
      ],
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { type: string; text?: string }[])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      if (result.isError) throw new Error(`${name}: ${text}`);
      return text;
    };
    const evaluate = async <T>(expression: string): Promise<T> => {
      const text = await call('browser_evaluate', { function: expression });
      const result = text.split('### Result\n')[1]?.split('\n###')[0]?.trim();
      if (!result) throw new Error(`Missing evaluation result: ${text}`);
      return JSON.parse(result) as T;
    };
    try {
      await ready;
      await client.connect(transport);
      await call('browser_navigate', { url: `http://localhost:${port}/` });
      await call('browser_type', { target: '#username', text: 'alice' });
      await call('browser_type', { target: '#password', text: password });
      await call('browser_click', { target: 'button[type="submit"]' });
      await call('browser_click', { target: 'button:has(.MuiAvatar-root)' });
      await call('browser_click', {
        target: 'role=menuitem[name="Two-step authentication"]',
      });
      await call('browser_type', {
        target: '.MuiDrawer-paper input[type="password"]',
        text: password,
      });
      await call('browser_click', {
        target: '.MuiDrawer-paper button[type="submit"]',
      });
      await call('browser_wait_for', { text: 'Manual setup key' });
      const secret = await evaluate<string>(
        '() => document.querySelector(".MuiDrawer-paper input[readonly]").value'
      );
      const screenshot = join(directory, 'enrollment.png');
      await call('browser_take_screenshot', {
        filename: screenshot,
        fullPage: true,
        scale: 'css',
      });
      const png = PNG.sync.read(await readFile(screenshot));
      const decoded = jsQR(
        new Uint8ClampedArray(png.data),
        png.width,
        png.height
      );
      expect(decoded).not.toBeNull();
      const uri = new URL(decoded!.data);
      expect(uri.protocol).toBe('otpauth:');
      expect(uri.searchParams.get('secret')).toBe(secret);
      expect(uri.searchParams.get('issuer')).toBe('Browser registry');
      await call('browser_type', {
        target: '.MuiDrawer-paper input[autocomplete="one-time-code"]',
        text: new TOTP({ secret }).generate(),
      });
      await call('browser_click', {
        target: '.MuiDrawer-paper button[type="submit"]',
      });
      await call('browser_wait_for', {
        text: 'Two-step authentication is enabled.',
      });
      const codes = await evaluate<string[]>(
        '() => document.querySelector(".MuiDrawer-paper pre").textContent.trim().split("\\n")'
      );
      expect(codes).toHaveLength(10);
      await call('browser_click', {
        target: '.MuiDrawer-paper button:has-text("Close")',
      });
      await call('browser_click', { target: 'button:has(.MuiAvatar-root)' });
      await call('browser_click', { target: 'role=menuitem[name="Logout"]' });
      await call('browser_type', { target: '#username', text: 'alice' });
      await call('browser_type', { target: '#password', text: password });
      await call('browser_click', { target: 'button[type="submit"]' });
      await call('browser_wait_for', { text: 'Use a recovery code' });
      const session = await evaluate<{ authenticated: boolean }>(
        'async () => { const response = await fetch("api/auth/session"); return await response.json(); }'
      );
      expect(session.authenticated).toBe(false);
      await call('browser_click', { target: 'input[type="checkbox"]' });
      await call('browser_type', {
        target: 'input[autocomplete="one-time-code"]',
        text: codes[0],
      });
      await call('browser_click', { target: 'button[type="submit"]' });
      await call('browser_click', { target: 'button:has(.MuiAvatar-root)' });
      await call('browser_click', {
        target: 'role=menuitem[name="Two-step authentication"]',
      });
      await call('browser_wait_for', {
        text: '9 unused recovery codes remaining.',
      });
      await call('browser_type', {
        target: '.MuiDrawer-paper input[type="password"]',
        text: password,
      });
      await call('browser_click', {
        target: '.MuiDrawer-paper input[type="checkbox"]',
      });
      await call('browser_type', {
        target: '.MuiDrawer-paper input[autocomplete="one-time-code"]',
        text: codes[1],
      });
      await call('browser_click', {
        target: '.MuiDrawer-paper button[value="disable"]',
      });
      await call('browser_wait_for', { text: 'Register authenticator' });
      const persisted = JSON.parse(
        await readFile(join(directory, 'users.json'), 'utf8')
      );
      expect(persisted[0].totp).toBeUndefined();
    } finally {
      await client.close();
      if (server.exitCode === null && server.signalCode === null) {
        const exited = once(server, 'exit');
        server.kill('SIGTERM');
        await exited;
      }
    }
  }, 120_000);
});
