import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { createReaderWriterLock } from 'async-primitives';
import { createFastifyInstance } from '../src/server.ts';
import { createTestDirectory } from './helpers/test-helper.ts';

it('limits expensive routes by the trusted client IP before processing the request', async () => {
  const dir = await createTestDirectory('limits', 'client IP');
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const app = await createFastifyInstance(
    {
      port: 0,
      configDir: dir,
      packageDir: join(dir, 'packages'),
      authMode: 'full',
    },
    logger,
    createReaderWriterLock()
  );
  try {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const [method, url] of [
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/login/totp'],
      ['POST', '/api/publish'],
      ['GET', '/api/config'],
      ['POST', '/api/ui/config'],
      ['GET', '/api/ui/icon/example/1.0.0'],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(
        Number(response.headers['x-ratelimit-limit']),
        url
      ).toBeGreaterThan(0);
    }
    for (const [method, url] of [
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/login/totp'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        payload: { username: 'example', password: 'x'.repeat(20_000) },
      });
      expect(response.statusCode, url).toBe(413);
    }
    const request = {
      method: 'POST' as const,
      url: '/api/auth/login',
      remoteAddress: '192.0.2.2',
    };
    const first = await app.inject(request);
    const remaining = Number(first.headers['x-ratelimit-remaining']);
    expect(first.statusCode).toBe(400);
    await Promise.all(
      Array.from({ length: remaining }, async () => await app.inject(request))
    );
    const limited = await app.inject({
      ...request,
      headers: { 'x-forwarded-for': '192.0.2.3', 'x-real-ip': '192.0.2.3' },
    });
    expect(limited.statusCode).toBe(429);
    const wait = Number(limited.headers['retry-after']);
    expect(wait).toBeGreaterThan(0);
    expect(
      (await app.inject({ ...request, remoteAddress: '192.0.2.4' })).statusCode
    ).toBe(400);
    vi.setSystemTime(Date.now() + wait * 1000);
    expect((await app.inject(request)).statusCode).toBe(400);
  } finally {
    vi.useRealTimers();
    await app.close();
  }
});
