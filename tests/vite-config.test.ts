import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Vite configuration loading', () => {
  it.each(['bundle', 'native'] as const)(
    'loads production and development configurations with %s',
    async (loader) => {
      // A separate Node process avoids Vitest transforming the native imports.
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
            import assert from 'node:assert/strict';
            import { resolve } from 'node:path';
            import { loadConfigFromFile } from 'vite';

            for (const target of ['server', 'ui', 'development']) {
              const development = target === 'development';
              process.env.BUILD_TARGET = development ? 'server' : target;
              const loaded = await loadConfigFromFile(
                {
                  command: development ? 'serve' : 'build',
                  mode: development ? 'development' : 'production',
                },
                'vite.config.ts',
                process.cwd(),
                'warn',
                undefined,
                process.env.TEST_CONFIG_LOADER
              );
              assert.ok(loaded);
              const { config } = loaded;
              if (target === 'server') {
                assert.equal(config.build.lib.entry, resolve('src/cli.ts'));
              } else {
                assert.equal(config.root, 'src/ui');
              }
              if (development) {
                assert.ok(config.plugins.flat().some(
                  (plugin) => plugin?.name === 'vite-plugin-fastify'
                ));
              }
            }
            console.log('Configurations loaded successfully');
          `,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TEST_CONFIG_LOADER: loader,
            VITE_CONFIG_NATIVE_IGNORE_WARNING: '',
          },
        }
      );

      expect(stdout).toContain('Configurations loaded successfully');
      expect(stderr).not.toContain("configLoader: 'native'");
    },
    30000
  );
});
