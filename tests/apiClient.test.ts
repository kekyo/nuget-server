// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  apiFetch,
  resetSessionExpiryHandling,
  setSessionHandler,
} from '../src/ui/utils/apiClient';

describe('api client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetSessionExpiryHandling();
    setSessionHandler(() => undefined, 'none');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    resetSessionExpiryHandling();
    setSessionHandler(() => undefined, 'none');
  });

  test('notifies the session expiry handler only once while the session remains expired', async () => {
    const sessionExpiredHandler = vi.fn();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 401 })
    );

    globalThis.fetch = fetchMock as typeof fetch;
    setSessionHandler(sessionExpiredHandler, 'full');

    const firstResponse = await apiFetch('v3/query?skip=0&take=20');
    const secondResponse = await apiFetch('api/ui/users');

    expect(firstResponse.status).toBe(401);
    expect(secondResponse.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sessionExpiredHandler).toHaveBeenCalledTimes(1);
    expect(sessionExpiredHandler).toHaveBeenCalledWith('full');
  });

  test('allows future session expiry notifications after the handler state is reset', async () => {
    const sessionExpiredHandler = vi.fn();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 401 })
    );

    globalThis.fetch = fetchMock as typeof fetch;
    setSessionHandler(sessionExpiredHandler, 'publish');

    await apiFetch('api/publish');
    resetSessionExpiryHandling();
    await apiFetch('api/publish');

    expect(sessionExpiredHandler).toHaveBeenCalledTimes(2);
    expect(sessionExpiredHandler).toHaveBeenNthCalledWith(1, 'publish');
    expect(sessionExpiredHandler).toHaveBeenNthCalledWith(2, 'publish');
  });
});
