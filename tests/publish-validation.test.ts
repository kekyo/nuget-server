// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import AdmZip from 'adm-zip';
import { createReaderWriterLock } from 'async-primitives';
import type { FastifyInstance } from 'fastify';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConsoleLogger } from '../src/logger.ts';
import { createFastifyInstance } from '../src/server.ts';
import { createTestDirectory } from './helpers/test-helper.ts';

describe('Package publication', () => {
  let server: FastifyInstance;
  let packagesRoot: string;
  let storageParent: string;

  beforeEach(async ({ task }) => {
    const configDir = await createTestDirectory(
      'publish-validation',
      task.name
    );
    storageParent = join(configDir, 'storage');
    packagesRoot = join(storageParent, 'packages');
    await mkdir(packagesRoot, { recursive: true });
    server = await createFastifyInstance(
      { port: 0, configDir, packageDir: packagesRoot, authMode: 'none' },
      createConsoleLogger('publish-validation', 'error'),
      createReaderWriterLock()
    );
  });

  afterEach(async () => {
    await server.close();
  });

  const publish = async (archive: AdmZip) =>
    await server.inject({
      method: 'POST',
      url: '/api/publish',
      headers: { 'content-type': 'application/octet-stream' },
      payload: archive.toBuffer(),
    });

  it.each([
    ['trailing dot in the ID', '<id>Example.</id><version>1.0.0</version>'],
    ['non-numeric version', '<id>Example</id><version>release</version>'],
    ['duplicate IDs', '<id>First</id><id>Second</id><version>1.0</version>'],
    [
      'structured version',
      '<id>Example</id><version><value>1.0</value></version>',
    ],
  ])(
    'rejects %s before publishing any files or metadata',
    async (_, fields) => {
      const archive = new AdmZip();
      archive.addFile(
        'example.nuspec',
        Buffer.from('<package><metadata>' + fields + '</metadata></package>')
      );
      const response = await publish(archive);

      expect(response.statusCode).toBe(400);
      const search = await server.inject({ method: 'GET', url: '/v3/query' });
      expect(search.json().totalHits).toBe(0);
      expect(await readdir(packagesRoot)).toEqual([]);
      expect(await readdir(storageParent)).toEqual(['packages']);
    }
  );

  it('publishes and serves a four-part NuGet version', async () => {
    const archive = new AdmZip();
    archive.addFile(
      'example.nuspec',
      Buffer.from(
        '<package><metadata><id>_Example.Core</id><version>1.2.3.4-rc.1+build.02</version></metadata></package>'
      )
    );
    const bytes = archive.toBuffer();
    const response = await publish(archive);
    expect(response.statusCode).toBe(201);
    const download = await server.inject({
      method: 'GET',
      url: '/v3/package/_example.core/1.2.3.4-rc.1+build.02/_example.core.1.2.3.4-rc.1+build.02.nupkg',
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(bytes);
  });
});
