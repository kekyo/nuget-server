import Fastify from 'fastify';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { expect, it, vi } from 'vitest';
import { registerPublishRoutes } from '../src/routes/api/publish/index.ts';
import { createAuthService } from '../src/services/authService.ts';
import { createUserService } from '../src/services/userService.ts';
import { createSessionService } from '../src/services/sessionService.ts';
import { createUrlResolver } from '../src/utils/urlResolver.ts';
import { createTestDirectory } from './helpers/test-helper.ts';

it('keeps an upload private while processing it and cleans up after success and rejection', async () => {
  const dir = await createTestDirectory('upload', 'staging permissions');
  const temporary = join(dir, 'temporary');
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
      packagesRoot: join(dir, 'packages'),
      logger,
      urlResolver: createUrlResolver(logger),
      authService: createAuthService({ authMode: 'none', logger }),
      authConfig: {
        logger,
        userService: createUserService({ configDir: dir, logger }),
        sessionService: createSessionService({ logger }),
      },
    });
    let stagingMode: number | undefined;
    routes.setPackageUploadService({
      addPackage: async () => {
        const [entry] = await readdir(temporary);
        stagingMode = (await stat(join(temporary, entry!))).mode & 0o077;
        return { action: 'added', message: 'Added' };
      },
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
    expect(
      (
        await app.inject({
          ...request,
          payload: Buffer.from('invalid package'),
        })
      ).statusCode
    ).toBe(400);
    expect(await readdir(temporary)).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    await app.close();
  }
});
