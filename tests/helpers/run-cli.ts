import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

/**
 * Runs the built CLI through configuration and stops it when the server is listening.
 * @param args - Individual CLI arguments, including paths that may contain spaces.
 * @param env - Environment overrides for this invocation.
 * @returns The configuration output or validation diagnostics.
 */
export const runCli = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
  const child = spawn(process.execPath, [resolve('dist/cli.mjs'), ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    killSignal: 'SIGKILL',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
    if (!child.killed && stdout.includes('Fastify server listening'))
      child.kill('SIGTERM');
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const [, signal] = await once(child, 'close');
  if (signal === 'SIGKILL')
    throw new Error('CLI did not finish starting: ' + stderr);
  return { stdout, stderr };
};
