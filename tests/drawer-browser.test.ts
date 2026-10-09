// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createUserService } from '../src/services/userService';
import { createTestDirectory, getTestPort } from './helpers/test-helper';

describe('Drawer animations through Playwright MCP', () => {
  it('closes temporary drawers through the right edge of the viewport', async () => {
    const directory = await createTestDirectory(
      'drawer-browser',
      'close-right'
    );
    const password = 'DrawerBrowserPassword!123';
    const users = createUserService({
      configDir: directory,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
        passwordStrengthCheck: false,
      })
    );
    const browserConfig = join(directory, 'browser.json');
    await writeFile(
      browserConfig,
      JSON.stringify({
        browser: {
          contextOptions: { locale: 'en-US', reducedMotion: 'no-preference' },
        },
      })
    );
    const client = new Client({ name: 'nuget-drawer-tests', version: '1.0.0' });
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
        '--caps',
        'devtools,vision',
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
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    try {
      let output = '';
      await new Promise<void>((resolveReady, reject) => {
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
      await client.connect(transport);
      await call('browser_navigate', { url: `http://127.0.0.1:${port}/` });
      await call('browser_type', { target: '#username', text: 'alice' });
      await call('browser_type', { target: '#password', text: password });
      await call('browser_click', { target: 'button[type="submit"]' });

      const cases = [
        { menu: 'Upload', close: 'button', width: 400 },
        { menu: 'Upload', close: 'escape', width: 400 },
        { menu: 'Upload', close: 'backdrop', width: 400 },
        { menu: 'Add User', close: 'button', width: 400 },
        { menu: 'Reset Password', close: 'button', width: 400 },
        { menu: 'Delete User', close: 'button', width: 400 },
        { menu: 'API Password', close: 'button', width: 500 },
      ];
      for (const viewportWidth of [1280, 700]) {
        await call('browser_resize', { width: viewportWidth, height: 800 });
        for (const scenario of cases) {
          const name = `${viewportWidth}-${scenario.menu}-${scenario.close}`;
          const video = join(directory, `${name}.webm`);
          await call('browser_start_video', { filename: video });
          try {
            if (scenario.menu === 'Upload') {
              await call('browser_click', {
                target: 'button:text-is("Upload")',
              });
            } else {
              await call('browser_click', {
                target: 'button:has(.MuiAvatar-root)',
              });
              await call('browser_click', {
                target: `role=menuitem[name="${scenario.menu}"]`,
              });
            }
            // Wait for the actual entrance animation, then record every rendered frame
            // until the drawer is removed. Fixed sleeps can miss a fast exit entirely.
            await evaluate(`async () => {
              const paper = document.querySelector('.MuiDrawer-paper');
              await Promise.all(paper.getAnimations().map(async (animation) => {
                await animation.finished;
              }));
              const rect = paper.getBoundingClientRect();
              const motion = window.drawerMotion = {
                initialLeft: rect.left, width: rect.width, viewportWidth: innerWidth,
                samples: [], done: false
              };
              const sample = () => {
                if (!paper.isConnected || getComputedStyle(paper).visibility === 'hidden') {
                  motion.done = true;
                  return;
                }
                motion.samples.push({ time: performance.now(), left: paper.getBoundingClientRect().left });
                requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
              return true;
            }`);
            if (scenario.close === 'escape') {
              await call('browser_press_key', { key: 'Escape' });
            } else if (scenario.close === 'backdrop') {
              await call('browser_mouse_click_xy', { x: 20, y: 400 });
            } else {
              await call('browser_click', {
                target: '.MuiDrawer-paper h2 + button',
              });
            }
            const motion = await evaluate<{
              initialLeft: number;
              width: number;
              viewportWidth: number;
              samples: { time: number; left: number }[];
              done: boolean;
            }>(`async () => {
              while (!window.drawerMotion.done) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
              }
              return window.drawerMotion;
            }`);
            await writeFile(
              join(directory, `${name}.json`),
              JSON.stringify(motion, null, 2)
            );
            expect.soft(motion.width, name).toBe(scenario.width);
            expect
              .soft(motion.initialLeft, name)
              .toBe(viewportWidth - scenario.width);
            expect.soft(motion.samples.length, name).toBeGreaterThan(2);
            const lefts = motion.samples.map((sample) => sample.left);
            expect
              .soft(Math.min(...lefts), name)
              .toBeGreaterThanOrEqual(motion.initialLeft - 1);
            // Allow the final frame to precede unmounting by one refresh interval.
            expect
              .soft(Math.max(...lefts), name)
              .toBeGreaterThan(viewportWidth - scenario.width * 0.1);
            for (let index = 1; index < lefts.length; index++) {
              expect
                .soft(lefts[index], name)
                .toBeGreaterThanOrEqual(lefts[index - 1]! - 1);
            }
          } finally {
            await call('browser_stop_video', {});
          }
          expect((await stat(video)).size).toBeGreaterThan(0);
        }
      }
    } finally {
      await client.close();
      if (server.exitCode === null && server.signalCode === null) {
        const exited = once(server, 'exit');
        server.kill('SIGTERM');
        await exited;
      }
    }
  }, 180_000);
});
