import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = resolve('build-docker-multiplatform.sh');

describe('Docker base image selection', () => {
  it.each(['node:24-trixie-slim', 'example.test/custom-node:latest'])(
    'builds both architectures when the shared %s tag changes',
    async (nodeImage) => {
      const directory = await mkdtemp(join(tmpdir(), 'nuget-server-base-'));
      try {
        // FIFOs force the tag replacement between the two builders' lookups,
        // without relying on sleeps or on the host's container storage.
        await execFileAsync('mkfifo', [
          join(directory, 'amd64-ready'),
          join(directory, 'arm64-ready'),
        ]);
        await writeFile(
          join(directory, 'podman'),
          `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
const directory = process.env.TEST_IMAGE_DIRECTORY;
const nodeImage = process.env.TEST_NODE_IMAGE;
const file = (name) => join(directory, name);
const option = (name) => args[args.indexOf(name) + 1];
const platform = option('--platform');
const imageIds = { 'linux/amd64': 'a'.repeat(64), 'linux/arm64': 'b'.repeat(64) };

switch (args[0]) {
  case 'run':
  case 'tag':
    break;
  case 'pull':
    if (args.at(-1) !== nodeImage || !imageIds[platform]) {
      throw new Error('Unexpected base image request: ' + args.join(' '));
    }
    writeFileSync(file('base-tag'), imageIds[platform]);
    console.log(imageIds[platform]);
    break;
  case 'build': {
    const base = option('--build-arg').replace(/^NODE_IMAGE=/, '');
    if (platform === 'linux/amd64') {
      if (base === nodeImage) writeFileSync(file('base-tag'), imageIds[platform]);
      writeFileSync(file('amd64-ready'), 'ready');
      readFileSync(file('arm64-ready'));
    } else {
      readFileSync(file('amd64-ready'));
      // Another architecture's pull moves the shared tag away from amd64.
      writeFileSync(file('base-tag'), imageIds[platform]);
      writeFileSync(file('arm64-ready'), 'ready');
    }
    const selected = base === nodeImage ? readFileSync(file('base-tag'), 'utf8') : base;
    if (selected !== imageIds[platform]) {
      console.error('Error: locating pulled image ' + base + ': image not known');
      process.exit(1);
    }
    writeFileSync(file(platform.split('/')[1]), selected);
    break;
  }
  case 'manifest':
    if (args[1] === 'add') appendFileSync(file('manifest'), args.at(-1) + '\\n');
    if (args[1] === 'inspect') {
      console.log(JSON.stringify({ manifests: Object.keys(imageIds).map((value) => {
        const [os, architecture] = value.split('/');
        return { platform: { os, architecture } };
      }) }));
    }
    break;
  default:
    throw new Error('Unexpected Podman command: ' + args.join(' '));
}
`,
          { mode: 0o755 }
        );

        const { stdout } = await execFileAsync(
          'bash',
          [
            scriptPath,
            '--skip-app-build',
            '--skip-verify',
            '--platforms',
            'linux/amd64,linux/arm64',
            '--jobs',
            '2',
            '--node-image',
            nodeImage,
          ],
          {
            env: {
              ...process.env,
              PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
              PUSH_TO_REGISTRY: 'false',
              TEST_IMAGE_DIRECTORY: directory,
              TEST_NODE_IMAGE: nodeImage,
            },
            timeout: 20_000,
          }
        );

        expect(await readFile(join(directory, 'amd64'), 'utf8')).toBe(
          'a'.repeat(64)
        );
        expect(await readFile(join(directory, 'arm64'), 'utf8')).toBe(
          'b'.repeat(64)
        );
        const manifest = await readFile(join(directory, 'manifest'), 'utf8');
        expect(manifest.trim().split('\n')).toEqual([
          expect.stringMatching(/-linux-amd64$/),
          expect.stringMatching(/-linux-arm64$/),
        ]);
        expect(stdout).toContain(
          'Multi-platform build completed successfully!'
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000
  );
});
