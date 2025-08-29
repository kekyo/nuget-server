// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * NuGet Service Index structure
 */
export interface NuGetServiceIndex {
  version: string;
  resources: Array<{
    "@id": string;
    "@type": string | string[];
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
      "@id": string;
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
}

/**
 * NuGet client service interface
 */
export interface NuGetClient {
  getServiceIndex: () => Promise<NuGetServiceIndex>;
  searchPackages: (
    searchUrl: string,
    skip: number,
    take: number,
  ) => Promise<SearchResult>;
  getPackageVersions: (
    packageBaseUrl: string,
    packageId: string,
  ) => Promise<string[]>;
  downloadPackage: (
    contentUrl: string,
    packageId: string,
    version: string,
  ) => Promise<Buffer>;
}

/**
 * Creates a NuGet client for interacting with remote NuGet servers
 * @param config - Client configuration
 * @returns NuGet client instance
 */
export const createNuGetClient = (config: NuGetClientConfig): NuGetClient => {
  const { baseUrl, username, password, timeout = 60000 } = config;

  // Create authorization header if credentials provided
  const authHeader =
    username && password
      ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
      : undefined;

  // Helper to make fetch requests with auth and timeout
  const fetchWithAuth = async (
    url: string,
    options: RequestInit = {},
  ): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string>),
      };

      if (authHeader) {
        headers["Authorization"] = authHeader;
      }

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle redirects manually if needed
      if (response.status === 301 || response.status === 302) {
        const location = response.headers.get("Location");
        if (location) {
          return fetchWithAuth(location, options);
        }
      }

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} for ${url}`,
        );
      }

      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeout}ms for ${url}`);
      }
      throw error;
    }
  };

  return {
    /**
     * Get the service index from the NuGet server
     */
    getServiceIndex: async (): Promise<NuGetServiceIndex> => {
      const indexUrl = baseUrl.endsWith("/")
        ? `${baseUrl}index.json`
        : `${baseUrl}/index.json`;

      const response = await fetchWithAuth(indexUrl);
      return await response.json();
    },

    /**
     * Search for packages
     */
    searchPackages: async (
      searchUrl: string,
      skip: number,
      take: number,
    ): Promise<SearchResult> => {
      const url = new URL(searchUrl);
      url.searchParams.set("q", "");
      url.searchParams.set("skip", skip.toString());
      url.searchParams.set("take", take.toString());
      url.searchParams.set("prerelease", "true");
      url.searchParams.set("semVerLevel", "2.0.0");

      const response = await fetchWithAuth(url.toString());
      return await response.json();
    },

    /**
     * Get all versions of a package
     */
    getPackageVersions: async (
      packageBaseUrl: string,
      packageId: string,
    ): Promise<string[]> => {
      const normalizedId = packageId.toLowerCase();
      const url = `${packageBaseUrl}/${normalizedId}/index.json`;

      const response = await fetchWithAuth(url);
      const data = (await response.json()) as PackageVersionsResponse;
      return data.versions;
    },

    /**
     * Download a package
     */
    downloadPackage: async (
      contentUrl: string,
      packageId: string,
      version: string,
    ): Promise<Buffer> => {
      const normalizedId = packageId.toLowerCase();
      const normalizedVersion = version.toLowerCase();
      const url = `${contentUrl}/${normalizedId}/${normalizedVersion}/${normalizedId}.${normalizedVersion}.nupkg`;

      const response = await fetchWithAuth(url);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },
  };
};
