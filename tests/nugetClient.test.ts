// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNuGetClient } from "../src/services/nugetClient";

describe("NuGetClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getServiceIndex", () => {
    it("should fetch service index successfully", async () => {
      const mockServiceIndex = {
        version: "3.0.0",
        resources: [
          {
            "@id": "https://api.nuget.org/v3/package",
            "@type": "PackageBaseAddress/3.0.0",
          },
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockServiceIndex),
      });

      const client = createNuGetClient({ baseUrl: "https://api.nuget.org/v3" });
      const result = await client.getServiceIndex();

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.nuget.org/v3/index.json",
        expect.objectContaining({
          headers: {},
          signal: expect.any(AbortSignal),
        }),
      );
      expect(result).toEqual(mockServiceIndex);
    });

    it("should include authentication header when credentials provided", async () => {
      const mockServiceIndex = {
        version: "3.0.0",
        resources: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockServiceIndex),
      });

      const client = createNuGetClient({
        baseUrl: "https://api.nuget.org/v3",
        username: "testuser",
        password: "testpass",
      });

      await client.getServiceIndex();

      const expectedAuth = Buffer.from("testuser:testpass").toString("base64");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.nuget.org/v3/index.json",
        expect.objectContaining({
          headers: {
            Authorization: `Basic ${expectedAuth}`,
          },
        }),
      );
    });

    it("should handle HTTP errors", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const client = createNuGetClient({ baseUrl: "https://api.nuget.org/v3" });

      await expect(client.getServiceIndex()).rejects.toThrow(
        "HTTP 404: Not Found",
      );
    });

    it("should handle redirects", async () => {
      const mockServiceIndex = {
        version: "3.0.0",
        resources: [],
      };

      // First call returns redirect
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 301,
        headers: {
          get: vi.fn().mockReturnValue("https://new-location.com/index.json"),
        },
      });

      // Second call returns success
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockServiceIndex),
      });

      const client = createNuGetClient({ baseUrl: "https://api.nuget.org/v3" });
      const result = await client.getServiceIndex();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://new-location.com/index.json",
        expect.any(Object),
      );
      expect(result).toEqual(mockServiceIndex);
    });
  });

  describe("searchPackages", () => {
    it("should search packages with correct query parameters", async () => {
      const mockSearchResult = {
        totalHits: 1,
        data: [
          {
            id: "TestPackage",
            version: "1.0.0",
            versions: [],
          },
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockSearchResult),
      });

      const client = createNuGetClient({ baseUrl: "https://api.nuget.org/v3" });
      const result = await client.searchPackages(
        "https://api.nuget.org/v3/search",
        0,
        100,
      );

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      const url = new URL(calledUrl);

      expect(url.searchParams.get("q")).toBe("");
      expect(url.searchParams.get("skip")).toBe("0");
      expect(url.searchParams.get("take")).toBe("100");
      expect(url.searchParams.get("prerelease")).toBe("true");
      expect(url.searchParams.get("semVerLevel")).toBe("2.0.0");
      expect(result).toEqual(mockSearchResult);
    });
  });

  describe("getPackageVersions", () => {
    it("should get package versions with normalized ID", async () => {
      const mockVersions = ["1.0.0", "1.1.0", "2.0.0"];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ versions: mockVersions }),
      });

      const client = createNuGetClient({ baseUrl: "https://api.nuget.org/v3" });
      const result = await client.getPackageVersions(
        "https://api.nuget.org/v3/package",
        "TestPackage",
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.nuget.org/v3/package/testpackage/index.json",
        expect.any(Object),
      );
      expect(result).toEqual(mockVersions);
    });
  });

  describe("downloadPackage", () => {
    it("should download package with normalized ID and version", async () => {
      const mockPackageData = new ArrayBuffer(100);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValueOnce(mockPackageData),
      });

      const client = createNuGetClient({ baseUrl: "https://api.nuget.org/v3" });
      const result = await client.downloadPackage(
        "https://api.nuget.org/v3/package",
        "TestPackage",
        "1.0.0",
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.nuget.org/v3/package/testpackage/1.0.0/testpackage.1.0.0.nupkg",
        expect.any(Object),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(100);
    });
  });
});
