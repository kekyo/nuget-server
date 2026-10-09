import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('dependency lifecycle', () => {
  it.each(['production', 'development'] as const)(
    'installs %s dependencies and runs their install scripts',
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), 'nuget-server-install-'));
      try {
        const manifest = JSON.parse(await readFile('package.json', 'utf8'));
        const options = {
          cwd: directory,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            // Do not let npm test's inherited PATH supply omitted development tools.
            PATH: (process.env.PATH ?? '')
              .split(delimiter)
              .filter((entry) => !entry.includes('node_modules'))
              .join(delimiter),
            npm_config_ignore_scripts: 'false',
            npm_config_audit: 'false',
            npm_config_fund: 'false',
          },
        };
        const runtimeDirectory = join(directory, 'runtime-package');
        await mkdir(runtimeDirectory);
        await writeFile(
          join(runtimeDirectory, 'package.json'),
          JSON.stringify({
            name: 'runtime-fixture',
            version: '1.0.0',
            scripts: {
              install:
                "node -e \"require('node:fs').writeFileSync('installed.txt', 'ready')\"",
            },
          })
        );
        await execFileAsync(
          'npm',
          ['pack', './runtime-package', '--ignore-scripts', '--offline'],
          options
        );
        await writeFile(
          join(directory, 'package.json'),
          JSON.stringify({
            name: 'dependency-lifecycle-fixture',
            version: '1.0.0',
            scripts: { dependencies: manifest.scripts.dependencies },
            dependencies: {
              'runtime-fixture': 'file:./runtime-fixture-1.0.0.tgz',
            },
            devDependencies: {
              'resolved-killer': `file:${resolve('node_modules/resolved-killer')}`,
            },
          })
        );
        await execFileAsync(
          'npm',
          ['install', '--package-lock-only', '--ignore-scripts', '--offline'],
          options
        );

        await execFileAsync(
          'npm',
          [
            'ci',
            mode === 'production' ? '--omit=dev' : '--include=dev',
            '--offline',
            '--foreground-scripts',
          ],
          options
        );

        expect(
          await readFile(
            join(directory, 'node_modules/runtime-fixture/installed.txt'),
            'utf8'
          )
        ).toBe('ready');
        if (mode === 'production') {
          expect(await readdir(join(directory, 'node_modules'))).not.toContain(
            'resolved-killer'
          );
        } else {
          const lock = JSON.parse(
            await readFile(join(directory, 'package-lock.json'), 'utf8')
          );
          expect(
            lock.packages['node_modules/runtime-fixture']
          ).not.toHaveProperty('resolved');
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000
  );
});
