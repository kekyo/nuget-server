// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOTP } from 'otpauth';
import { createTotpService } from '../src/services/totpService.ts';
import { createUserService } from '../src/services/userService.ts';
import { createTestDirectory, getTestPort } from './helpers/test-helper.ts';

describe('Login autofill through Playwright MCP', () => {
  it.each([
    { state: 'empty', totpEnabled: false },
    { state: 'stale', totpEnabled: true },
  ])(
    'authenticates autofilled values with $state state (TOTP: $totpEnabled)',
    async ({ state, totpEnabled }) => {
      const directory = await createTestDirectory('login-autofill', state);
      // Whitespace in passwords is significant; usernames are trimmed.
      const password = ' AutofillPassword!123 ';
      const users = createUserService({
        configDir: directory,
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
        serverConfig: { port: 5963, passwordStrengthCheck: false },
      });
      let recoveryCode = '';
      try {
        await users.initialize();
        await users.createUser({ username: 'alice', password, role: 'admin' });
        if (totpEnabled) {
          const totp = createTotpService({
            users,
            keyFile: join(directory, 'totp.key'),
            issuer: 'Autofill registry',
          });
          try {
            await totp.initialize();
            const user = (await users.getUser('alice'))!;
            const setup = await totp.setup(
              user,
              'enrollment',
              password,
              '127.0.0.1',
              '',
              false
            );
            const confirmed = await totp.confirm(
              'enrollment',
              new TOTP({ secret: setup.secret }).generate(),
              '127.0.0.1'
            );
            // Recovery avoids waiting for the enrollment code to expire.
            recoveryCode = confirmed.recoveryCodes[0]!;
          } finally {
            totp.destroy();
          }
        }
      } finally {
        users.destroy();
      }

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
          realm: 'Autofill registry',
          passwordStrengthCheck: false,
        })
      );
      const browserConfig = join(directory, 'browser.json');
      await writeFile(
        browserConfig,
        JSON.stringify({ browser: { contextOptions: { locale: 'en-US' } } })
      );
      const client = new Client({
        name: 'nuget-autofill-tests',
        version: '1.0.0',
      });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          resolve(
            process.env.PLAYWRIGHT_MCP_CLI_PATH ??
              'node_modules/@playwright/mcp/cli.js'
          ),
          '--headless',
          '--isolated',
          '--browser',
          'chromium',
          '--config',
          browserConfig,
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
      try {
        let output = '';
        await new Promise<void>((resolveReady, reject) => {
          server.on('error', reject);
          server.on('exit', () =>
            reject(new Error(`Server stopped: ${output}`))
          );
          server.stdout.on('data', (data) => {
            output += data.toString();
            if (output.includes('Fastify server listening')) resolveReady();
          });
          server.stderr.on('data', (data) => {
            output += data.toString();
          });
        });
        await client.connect(transport);
        await call('browser_navigate', { url: `http://127.0.0.1:${port}/` });
        await call('browser_wait_for', { text: 'Username' });
        if (state === 'stale') {
          await call('browser_type', { target: '#username', text: 'old-user' });
          await call('browser_type', {
            target: '#password',
            text: 'OldPassword!456',
          });
        }

        // Simulate autofill that changes DOM values without notifying React.
        // Submit in the same task, as password managers can also auto-submit.
        await evaluate(`() => {
          document.querySelector('#username').value = ' alice ';
          document.querySelector('#password').value = ${JSON.stringify(password)};
          document.querySelector('button[type="submit"]').click();
          return true;
        }`);
        if (totpEnabled) {
          await call('browser_wait_for', { text: 'Use a recovery code' });
          const session = await evaluate<{ authenticated: boolean }>(
            'async () => await (await fetch("api/auth/session")).json()'
          );
          expect(session.authenticated).toBe(false);
          await call('browser_click', { target: 'input[type="checkbox"]' });
          await call('browser_type', {
            target: 'input[autocomplete="one-time-code"]',
            text: 'old-recovery-code',
          });
          await evaluate(`() => {
            document.querySelector('input[autocomplete="one-time-code"]').value = ${JSON.stringify(` ${recoveryCode} `)};
            document.querySelector('button[type="submit"]').click();
            return true;
          }`);
        }
        await call('browser_wait_for', { text: 'Upload' });
        const session = await evaluate<{
          authenticated: boolean;
          user: { username: string };
        }>('async () => await (await fetch("api/auth/session")).json()');
        expect(session.authenticated).toBe(true);
        expect(session.user.username).toBe('alice');
      } finally {
        await client.close();
        if (server.exitCode === null) {
          server.kill('SIGTERM');
          await once(server, 'exit');
        }
      }
    },
    120_000
  );
});
