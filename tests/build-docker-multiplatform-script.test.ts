import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, it, expect } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), 'build-docker-multiplatform.sh');

describe('build-docker-multiplatform.sh', () => {
  it('should be valid bash syntax', async () => {
    await execFileAsync('bash', ['-n', scriptPath]);
  });

  it('should expose verification options in help', async () => {
    const { stdout } = await execFileAsync('bash', [scriptPath, '--help']);

    expect(stdout).toContain('--skip-target-verify');
    expect(stdout).toContain('--skip-host-smoke');
    expect(stdout).toContain('--skip-verify');
    expect(stdout).toContain('VERIFY_TARGET_PLATFORMS');
    expect(stdout).toContain('VERIFY_HOST_IMAGE');
  });
});
