// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import AdmZip from 'adm-zip';
import { createReaderWriterLock } from 'async-primitives';
import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdir,
  readdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConsoleLogger } from '../src/logger.ts';
import { createMetadataService } from '../src/services/metadataService.ts';
import { createFastifyInstance } from '../src/server.ts';
import {
  createTestDirectory,
  getTestPort,
  waitForServerReady,
} from './helpers/test-helper.ts';

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
        '<package><metadata><id>_Example.Core</id><version>1.2.3.4-RC.1+Build.02</version></metadata></package>'
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

  it.each([
    ['images/logo.PNG', 'icon.png'],
    ['images/logo.JPEG', 'icon.jpeg'],
    ['images/logo.jpg', 'icon.jpg'],
    ['images/readme.txt', undefined],
    ['images/logo', undefined],
  ])('only extracts a supported icon from %s', async (entry, expected) => {
    const archive = new AdmZip();
    archive.addFile(
      'example.nuspec',
      Buffer.from(
        '<package><metadata><id>Example</id><version>1.0</version><icon>' +
          entry +
          '</icon></metadata></package>'
      )
    );
    archive.addFile(entry, Buffer.from('icon contents'));

    expect((await publish(archive)).statusCode).toBe(201);
    const directory = join(packagesRoot, 'Example', '1.0');
    const files = ['Example.1.0.nupkg', 'Example.nuspec'];
    if (expected) {
      files.push(expected);
      expect(await readFile(join(directory, expected), 'utf8')).toBe(
        'icon contents'
      );
    }
    expect((await readdir(directory)).sort()).toEqual(files.sort());
  });

  it('keeps a failed save out of the registry and permits a retry', async () => {
    const archive = new AdmZip();
    archive.addFile(
      'example.nuspec',
      Buffer.from(
        '<package><metadata><id>Example</id><version>1.0</version></metadata></package>'
      )
    );
    const obstruction = join(packagesRoot, 'Example');
    await writeFile(obstruction, 'existing file');

    expect((await publish(archive)).statusCode).toBe(500);
    expect((await server.inject('/v3/query')).json().totalHits).toBe(0);
    expect(await readFile(obstruction, 'utf8')).toBe('existing file');
    await unlink(obstruction);
    expect((await publish(archive)).statusCode).toBe(201);
  });

  it('can publish into an existing version directory without disturbing other files', async () => {
    const directory = join(packagesRoot, 'Example', '1.0');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'notes.txt'), 'local notes');
    const archive = new AdmZip();
    archive.addFile(
      'example.nuspec',
      Buffer.from(
        '<package><metadata><id>Example</id><version>1.0</version></metadata></package>'
      )
    );
    expect((await publish(archive)).statusCode).toBe(201);
    expect(await readFile(join(directory, 'notes.txt'), 'utf8')).toBe(
      'local notes'
    );
  });

  it('only loads complete published versions after a restart', async () => {
    const manifest = (version: string) =>
      `<package><metadata><id>Example</id><version>${version}</version></metadata></package>`;
    const archive = new AdmZip();
    archive.addFile('example.nuspec', Buffer.from(manifest('1.0')));
    expect((await publish(archive)).statusCode).toBe(201);
    const staging = join(packagesRoot, 'Example', '.publish-unfinished');
    const incomplete = join(packagesRoot, 'Example', '2.0');
    await mkdir(staging);
    await mkdir(incomplete);
    await writeFile(join(staging, 'Example.nuspec'), manifest('1.0'));
    await writeFile(join(staging, 'Example.1.0.nupkg'), archive.toBuffer());
    await writeFile(join(incomplete, 'Example.nuspec'), manifest('2.0'));

    const cache = createMetadataService(
      packagesRoot,
      '',
      createConsoleLogger('publish-validation', 'error')
    );
    await cache.initialize();
    expect(
      cache.getPackageMetadata('Example').map((entry) => entry.version)
    ).toEqual(['1.0']);
    expect(
      cache.getPackageEntry('Example', '1.0')?.storage.versionDirName
    ).toBe('1.0');
    archive.updateFile('example.nuspec', Buffer.from(manifest('2.0')));
    expect((await publish(archive)).statusCode).toBe(201);
    expect(
      (await server.inject('/v3/package/example/2.0/example.2.0.nupkg'))
        .rawPayload
    ).toEqual(archive.toBuffer());
  });

  it('refuses a linked package directory before registering the upload', async () => {
    const other = join(packagesRoot, 'Other');
    await mkdir(other);
    await symlink(other, join(packagesRoot, 'Example'), 'junction');
    const archive = new AdmZip();
    archive.addFile(
      'example.nuspec',
      Buffer.from(
        '<package><metadata><id>Example</id><version>1.0</version></metadata></package>'
      )
    );
    expect((await publish(archive)).statusCode).toBe(500);
    expect((await server.inject('/v3/query')).json().totalHits).toBe(0);
    expect(await readdir(other)).toEqual([]);
  });

  it('keeps the winning archive when concurrent publications differ only in case', async () => {
    const archives = ['RC', 'rc'].map((label) => {
      const zip = new AdmZip();
      zip.addFile(
        'example.nuspec',
        Buffer.from(
          '<package><metadata><id>Example</id><version>1.0-' +
            label +
            '</version></metadata></package>'
        )
      );
      return zip;
    });
    const responses = await Promise.all(archives.map(publish));
    const statuses = responses.map((response) => response.statusCode);
    expect([...statuses].sort()).toEqual([200, 201]);
    const download = await server.inject(
      '/v3/package/example/1.0-rc/example.1.0-rc.nupkg'
    );
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(
      archives[statuses.indexOf(201)]!.toBuffer()
    );
  });
});

it('publishes and downloads a package with the built CLI', async ({ task }) => {
  const directory = await createTestDirectory('publish-cli', task.name);
  const port = await getTestPort(12000);
  const cli = spawn(
    process.execPath,
    [
      resolve('dist/cli.mjs'),
      '--port',
      String(port),
      '--package-dir',
      join(directory, 'packages'),
      '--auth-mode',
      'none',
      '--log-level',
      'error',
    ],
    { cwd: directory, stdio: 'ignore' }
  );
  const closed = once(cli, 'exit');
  try {
    await waitForServerReady(port, 'none');
    const archive = await readFile(
      resolve('tests/fixtures/packages/FlashCap.1.10.0.nupkg')
    );
    const baseUrl = `http://127.0.0.1:${port}`;
    const upload = await fetch(`${baseUrl}/api/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(archive),
    });
    expect(upload.status).toBe(201);
    const download = await fetch(
      `${baseUrl}/v3/package/flashcap/1.10.0/flashcap.1.10.0.nupkg`
    );
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(archive);
  } finally {
    cli.kill();
    await closed;
  }
});
