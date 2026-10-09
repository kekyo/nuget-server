import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createReaderWriterLock } from 'async-primitives';
import { describe, expect, it, vi } from 'vitest';
import { createFastifyInstance } from '../src/server.ts';

describe('Fastify logging', () => {
  it('keeps custom logging without automatic request logs or deprecation warnings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nuget-server-logging-'));
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const warnings: string[] = [];
    const onWarning = (warning: Error & { code?: string }) => {
      warnings.push(warning.code ?? warning.name);
    };
    const locker = createReaderWriterLock();
    let server: Awaited<ReturnType<typeof createFastifyInstance>> | undefined;
    process.on('warning', onWarning);
    try {
      server = await createFastifyInstance(
        {
          port: 0,
          configDir: directory,
          packageDir: join(directory, 'packages'),
          authMode: 'none',
          logLevel: 'debug',
          sessionSecret: 'test-session-secret',
        },
        logger,
        locker
      );
      server.get('/logging-test', async (request) => {
        request.log.info('Custom request log');
        return { success: true };
      });
      for (const method of Object.values(logger)) method.mockClear();

      server.log.warn('Custom server warning');
      const response = await server.inject('/logging-test');
      // Node emits process warnings on the next tick.
      await setImmediate();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(logger.info.mock.calls).toEqual([['Custom request log']]);
      expect(logger.warn.mock.calls).toEqual([['Custom server warning']]);
      expect(logger.error).not.toHaveBeenCalled();
      expect(warnings).not.toContain('FSTDEP023');
    } finally {
      process.off('warning', onWarning);
      const lock = await locker.writeLock();
      try {
        await server?.close();
      } finally {
        lock.release();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
});
