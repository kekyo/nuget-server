import Fastify from 'fastify';
import { createReaderWriterLock } from 'async-primitives';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { streamUiFile } from '../src/utils/fileStreaming.ts';
import { createTestDirectory } from './helpers/test-helper.ts';

it('streams regular UI assets within a configured root, including when the root itself is a link', async () => {
  const directory = await createTestDirectory('ui-assets', 'regular files');
  const root = join(directory, 'assets');
  const configured = join(directory, 'configured');
  await mkdir(root);
  await symlink(root, configured, 'dir');
  await writeFile(join(root, 'example.css'), 'body{}');
  await symlink('example.css', join(root, 'alias.css'));
  const app = Fastify();
  const lock = createReaderWriterLock();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  app.get<{ Params: { name: string } }>(
    '/:name',
    async (request, reply) =>
      await streamUiFile(
        logger,
        lock,
        configured,
        request.params.name,
        reply,
        undefined
      )
  );
  try {
    const data = await app.inject('/example.css');
    expect(data.body).toBe('body{}');
    expect(data.headers['content-type']).toContain('text/css');
    expect(data.headers['content-length']).toBe('6');
    expect((await app.inject('/alias.css')).statusCode).toBe(404);
    expect((await app.inject('/absent.css')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
