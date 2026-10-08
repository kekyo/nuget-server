import { describe, expect, it, vi } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { TOTP } from 'otpauth';
import { createServer, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fastifyHost } from '../src/plugins/vite-plugin-fastify';
import { createUserService } from '../src/services/userService';
import { createTestDirectory, getTestPort } from './helpers/test-helper';

describe('TOTP browser enrollment through Playwright MCP', () => {
  it.each(['production', 'development'] as const)(
    'decodes the displayed QR, enrolls, recovers login, and disables TOTP in %s',
    async (mode) => {
      const directory = await createTestDirectory(
        'totp-browser',
        `QR registration and recovery in ${mode}`
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
      let server: ChildProcess | undefined;
      let developmentServer: ViteDevServer | undefined;
      const startServer = async (): Promise<void> => {
        if (mode === 'development') {
          developmentServer = await createServer({
            configFile: false,
            root: resolve('src/ui'),
            base: './',
            cacheDir: join(directory, 'vite-cache'),
            logLevel: 'silent',
            plugins: [
              react(),
              fastifyHost({
                port,
                configDir: directory,
                packageDir: join(directory, 'packages'),
                authMode: 'publish',
                realm: 'Browser registry',
                passwordStrengthCheck: false,
              }),
            ],
            server: { host: '127.0.0.1', port, strictPort: true, watch: null },
          });
          await developmentServer.listen();
          return;
        }
        const child = spawn(
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
        server = child;
        let output = '';
        await new Promise<void>((resolveReady, reject) => {
          child.on('error', reject);
          child.on('exit', () =>
            reject(new Error(`Server stopped: ${output}`))
          );
          child.stdout.on('data', (data) => {
            output += data.toString();
            if (output.includes('Fastify server listening')) resolveReady();
          });
          child.stderr.on('data', (data) => {
            output += data.toString();
          });
        });
      };
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
          // A cold Vite dependency build can exceed the default navigation timeout.
          '--timeout-navigation',
          '180000',
          ...(process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH
            ? ['--executable-path', process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH]
            : []),
        ],
      });
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool(
          { name, arguments: args },
          undefined,
          { timeout: 210_000 }
        );
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
        await startServer();
        await client.connect(transport);
        await call('browser_navigate', { url: `http://127.0.0.1:${port}/` });
        if (mode === 'development') {
          await call('browser_click', {
            target: 'button:has(.MuiAvatar-root)',
          });
          await call('browser_click', {
            target: 'role=menuitem[name="Login"]',
          });
        }
        await call('browser_type', { target: '#username', text: 'alice' });
        await call('browser_type', { target: '#password', text: password });
        await call('browser_click', { target: 'button[type="submit"]' });
        if (mode === 'development') {
          await call('browser_click', { target: 'button:text-is("Upload")' });
          await call('browser_click', {
            target: 'text=or click to browse files',
          });
          await call('browser_file_upload', {
            paths: [resolve('tests/fixtures/packages/FlashCap.1.10.0.nupkg')],
          });
          await call('browser_click', {
            target: 'role=button[name="Upload 1 file"]',
          });
          await call('browser_wait_for', {
            text: 'All 1 package uploaded successfully!',
          });
          const uploaded = await readFile(
            join(
              directory,
              'packages',
              'FlashCap',
              '1.10.0',
              'FlashCap.1.10.0.nupkg'
            )
          );
          expect(uploaded.length).toBeGreaterThan(0);
          await call('browser_click', {
            target: '.MuiDrawer-paper button:has(svg[data-testid="CloseIcon"])',
          });
          await call('browser_navigate', { url: `http://127.0.0.1:${port}/` });
          await call('browser_wait_for', { text: 'Upload' });
        }
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
        if (mode === 'development') {
          await call('browser_click', {
            target: 'button:has(.MuiAvatar-root)',
          });
          await call('browser_click', {
            target: 'role=menuitem[name="Login"]',
          });
        }
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
        await developmentServer?.close();
        if (server && server.exitCode === null && server.signalCode === null) {
          const exited = once(server, 'exit');
          server.kill('SIGTERM');
          await exited;
        }
      }
    },
    300_000
  );
});
