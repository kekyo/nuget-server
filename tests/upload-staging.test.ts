import Fastify from 'fastify';
import { mkdir, readdir, rename, stat } from 'fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { expect, it, vi } from 'vitest';
import { registerPublishRoutes } from '../src/routes/api/publish/index.ts';
import { createAuthService } from '../src/services/authService.ts';
import { createMetadataService } from '../src/services/metadataService.ts';
import { createUserService } from '../src/services/userService.ts';
import { createSessionService } from '../src/services/sessionService.ts';
import { createUrlResolver } from '../src/utils/urlResolver.ts';
import { createTestDirectory } from './helpers/test-helper.ts';

vi.mock(import('fs/promises'), async (importOriginal) => {
  const fs = await importOriginal();
  return { ...fs, rename: vi.fn(fs.rename) };
});

it('keeps an upload private while processing it and cleans up after success and rejection', async () => {
  const dir = await createTestDirectory('upload', 'staging permissions');
  const temporary = join(dir, 'temporary');
  const packagesRoot = join(dir, 'packages');
  const packageDir = join(packagesRoot, 'Example');
  await mkdir(temporary);
  vi.stubEnv('TMPDIR', temporary);
  const app = Fastify();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  try {
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body)
    );
    const routes = await registerPublishRoutes(app, {
      packagesRoot,
      logger,
      urlResolver: createUrlResolver(logger),
      authService: createAuthService({ authMode: 'none', logger }),
      authConfig: {
        logger,
        userService: createUserService({ configDir: dir, logger }),
        sessionService: createSessionService({ logger }),
      },
    });
    routes.setPackageUploadService(
      createMetadataService(packagesRoot, '', logger)
    );
    const fs =
      await vi.importActual<typeof import('fs/promises')>('fs/promises');
    let stagingMode: number | undefined;
    // Inspect the real directory immediately before the version becomes public.
    vi.mocked(rename).mockImplementationOnce(async (source, target) => {
      const [entry] = await readdir(packageDir);
      stagingMode = (await stat(join(packageDir, entry!))).mode & 0o077;
      expect(await readdir(temporary)).toEqual([]);
      await fs.rename(source, target);
    });
    const archive = new AdmZip();
    archive.addFile(
      'Example.nuspec',
      Buffer.from(
        '<package><metadata><id>Example</id><version>1.0.0</version></metadata></package>'
      )
    );
    const request = {
      method: 'POST' as const,
      url: '/publish',
      headers: { 'content-type': 'application/octet-stream' },
    };
    expect(
      (await app.inject({ ...request, payload: archive.toBuffer() })).statusCode
    ).toBe(201);
    expect(stagingMode).toBe(0);
    expect(await readdir(temporary)).toEqual([]);
    expect(await readdir(packageDir)).toEqual(['1.0.0']);
    expect(
      (
        await app.inject({
          ...request,
          payload: Buffer.from('invalid package'),
        })
      ).statusCode
    ).toBe(400);
    expect(await readdir(temporary)).toEqual([]);
    expect(await readdir(packageDir)).toEqual(['1.0.0']);
  } finally {
    vi.unstubAllEnvs();
    await app.close();
  }
});
