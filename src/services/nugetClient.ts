// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * NuGet Service Index structure
 */
export interface NuGetServiceIndex {
  version: string;
  resources: Array<{
    '@id': string;
    '@type': string | string[];
    comment?: string;
  }>;
}

/**
 * Search result from NuGet API
 */
export interface SearchResult {
  totalHits: number;
  data: Array<{
    id: string;
    version: string;
    versions: Array<{
      version: string;
      '@id': string;
    }>;
  }>;
}

/**
 * Package versions response
 */
export interface PackageVersionsResponse {
  versions: string[];
}

/**
 * Configuration for NuGet client
 */
export interface NuGetClientConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  timeout?: number;
  /** Maximum decoded bytes in a single metadata or archive response. Defaults to 100 MiB. */
  maxResponseBytes?: number;
}

/**
 * NuGet client service interface
 */
export interface NuGetClient {
  getServiceIndex: () => Promise<NuGetServiceIndex>;
  searchPackages: (
    searchUrl: string,
    skip: number,
    take: number
  ) => Promise<SearchResult>;
  getPackageVersions: (
    packageBaseUrl: string,
    packageId: string
  ) => Promise<string[]>;
  downloadPackage: (
    contentUrl: string,
    packageId: string,
    version: string
  ) => Promise<Buffer>;
}

/**
 * Creates a NuGet client for interacting with remote NuGet servers
 * @param config - Client configuration
 * @returns NuGet client instance
 */
export const createNuGetClient = (config: NuGetClientConfig): NuGetClient => {
  const {
    baseUrl,
    username,
    password,
    timeout = 60_000,
    maxResponseBytes = 100 * 1024 * 1024,
  } = config;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
    throw new Error('Invalid source response size limit');
  const origin = new URL(baseUrl).origin;
  // Keep credentials on the configured feed's origin. A service index may name a separate public CDN.
  const authHeader =
    username && password
      ? 'Basic ' + Buffer.from(username + ':' + password).toString('base64')
      : undefined;

  const fetchWithAuth = async (value: string): Promise<Buffer> => {
    let url = new URL(value);
    const signal = AbortSignal.timeout(timeout);
    for (let redirects = 0; redirects <= 10; redirects++) {
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error(
          'Expected an HTTP(S) source URL without embedded credentials'
        );
      const headers: Record<string, string> = {};
      if (authHeader && url.origin === origin)
        headers.Authorization = authHeader;
      const response = await fetch(url.href, {
        headers,
        signal,
        redirect: 'manual',
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('Source redirect has no location');
        const next = new URL(location, url);
        if (url.protocol === 'https:' && next.protocol !== 'https:')
          throw new Error('Source redirect downgrades HTTPS');
        url = next;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }
      const tooLarge = new Error('Source response exceeds the size limit');
      if (Number(response.headers.get('content-length')) > maxResponseBytes) {
        await response.body?.cancel();
        throw tooLarge;
      }
      if (!response.body) return Buffer.alloc(0);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value: chunk, done } = await reader.read();
          if (done) return Buffer.concat(chunks, size);
          size += chunk.byteLength;
          if (size > maxResponseBytes) {
            await reader.cancel();
            throw tooLarge;
          }
          chunks.push(chunk);
        }
      } finally {
        reader.releaseLock();
      }
    }
    throw new Error('Too many source redirects');
  };

  const readJson = async <T>(url: string): Promise<T> =>
    JSON.parse(new TextDecoder().decode(await fetchWithAuth(url))) as T;

  return {
    /**
     * Get the service index from the NuGet server
     */
    getServiceIndex: async (): Promise<NuGetServiceIndex> => {
      const indexUrl = baseUrl.endsWith('/')
        ? `${baseUrl}index.json`
        : `${baseUrl}/index.json`;

      return await readJson<NuGetServiceIndex>(indexUrl);
    },

    /**
     * Search for packages
     */
    searchPackages: async (
      searchUrl: string,
      skip: number,
      take: number
    ): Promise<SearchResult> => {
      const url = new URL(searchUrl);
      url.searchParams.set('q', '');
      url.searchParams.set('skip', skip.toString());
      url.searchParams.set('take', take.toString());
      url.searchParams.set('prerelease', 'true');
      url.searchParams.set('semVerLevel', '2.0.0');

      return await readJson<SearchResult>(url.toString());
    },

    /**
     * Get all versions of a package
     */
    getPackageVersions: async (
      packageBaseUrl: string,
      packageId: string
    ): Promise<string[]> => {
      const normalizedId = packageId.toLowerCase();
      const url = `${packageBaseUrl}/${normalizedId}/index.json`;

      const data = await readJson<PackageVersionsResponse>(url);
      return data.versions;
    },

    /**
     * Download a package
     */
    downloadPackage: async (
      contentUrl: string,
      packageId: string,
      version: string
    ): Promise<Buffer> => {
      const normalizedId = packageId.toLowerCase();
      const normalizedVersion = version.toLowerCase();
      const url = `${contentUrl}/${normalizedId}/${normalizedVersion}/${normalizedId}.${normalizedVersion}.nupkg`;

      return await fetchWithAuth(url);
    },
  };
};
