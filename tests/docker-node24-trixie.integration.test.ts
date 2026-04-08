import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, it, expect } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), 'build-docker-multiplatform.sh');
const shouldRunIntegration =
  process.env['RUN_DOCKER_NODE24_TRIXIE_TEST'] === 'true';

const integrationTest = shouldRunIntegration ? it : it.skip;

describe('Docker node:24-trixie-slim integration', () => {
  integrationTest(
    'should build and start successfully on amd64 and arm64 with the default Node image',
    async () => {
      const { stdout } = await execFileAsync(
        'bash',
        [
          scriptPath,
          '--skip-app-build',
          '--platforms',
          'linux/amd64,linux/arm64',
          '--jobs',
          '2',
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          maxBuffer: 20 * 1024 * 1024,
        }
      );

      expect(stdout).toContain('Node image: node:24-trixie-slim');
      expect(stdout).toContain('Binary load check on linux/amd64');
      expect(stdout).toContain('Binary load check on linux/arm64');
      expect(stdout).toContain('All target platform checks passed');
      expect(stdout).toContain('Host image check passed');
    },
    20 * 60 * 1000
  );
});
