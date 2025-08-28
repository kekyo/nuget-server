// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect } from "vitest";
import { createUrlResolver } from "../src/utils/urlResolver";

describe("urlResolver - resolveUrl without fixed baseUrl", () => {
  it("should use request protocol and host by default", () => {
    const resolver = createUrlResolver();
    const request = {
      protocol: "http",
      headers: {
        host: "example.com",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("http://example.com");
    expect(result.isFixed).toBe(false);
  });

  it("should handle https protocol", () => {
    const resolver = createUrlResolver();
    const request = {
      protocol: "https",
      headers: {
        host: "secure.example.com",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://secure.example.com");
    expect(result.isFixed).toBe(false);
  });

  it("should use X-Forwarded headers when from trusted proxy", () => {
    const resolver = createUrlResolver({ trustedProxies: ["192.168.1.1"] });
    const request = {
      protocol: "http",
      ip: "192.168.1.1",
      headers: {
        host: "internal.local",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "public.example.com",
        "x-forwarded-port": "8443",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://public.example.com:8443");
    expect(result.isFixed).toBe(false);
  });

  it("should ignore X-Forwarded headers when not from trusted proxy", () => {
    const resolver = createUrlResolver({ trustedProxies: ["192.168.1.1"] });
    const request = {
      protocol: "http",
      ip: "10.0.0.1", // Not in trusted proxies
      headers: {
        host: "internal.local",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "public.example.com",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("http://internal.local");
    expect(result.isFixed).toBe(false);
  });

  it("should parse RFC 7239 Forwarded header", () => {
    const resolver = createUrlResolver();
    const request = {
      protocol: "http",
      headers: {
        host: "internal.local",
        forwarded: "proto=https;host=api.example.com;port=443",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://api.example.com:443");
    expect(result.isFixed).toBe(false);
  });

  it("should prefer Forwarded header over X-Forwarded headers", () => {
    const resolver = createUrlResolver();
    const request = {
      protocol: "http",
      headers: {
        host: "internal.local",
        forwarded: "proto=https;host=forwarded.example.com",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "x-forwarded.example.com",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://forwarded.example.com");
    expect(result.isFixed).toBe(false);
  });

  it("should handle quoted values in Forwarded header", () => {
    const resolver = createUrlResolver();
    const request = {
      protocol: "http",
      headers: {
        host: "internal.local",
        forwarded: 'proto="https";host="api.example.com"',
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://api.example.com");
    expect(result.isFixed).toBe(false);
  });

  it("should handle X-Forwarded-For in trusted proxy check", () => {
    const resolver = createUrlResolver({ trustedProxies: ["192.168.1.100"] });
    const request = {
      protocol: "http",
      ip: "10.0.0.1",
      headers: {
        host: "internal.local",
        "x-forwarded-for": "192.168.1.100, 10.0.0.1",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "public.example.com",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://public.example.com");
    expect(result.isFixed).toBe(false);
  });

  it("should use socket.remoteAddress when ip is not available", () => {
    const resolver = createUrlResolver({ trustedProxies: ["192.168.1.1"] });
    const request = {
      protocol: "http",
      headers: {
        host: "internal.local",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "public.example.com",
      },
      socket: {
        remoteAddress: "192.168.1.1",
      },
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://public.example.com");
    expect(result.isFixed).toBe(false);
  });

  it("should handle missing Host header", () => {
    const resolver = createUrlResolver();
    const request = {
      protocol: "http",
      headers: {},
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("http://localhost");
    expect(result.isFixed).toBe(false);
  });

  it("should not add port if host already contains it", () => {
    const resolver = createUrlResolver();
    const request = {
      protocol: "http",
      headers: {
        host: "example.com:8080",
        "x-forwarded-port": "443",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("http://example.com:8080");
    expect(result.isFixed).toBe(false);
  });

  it("should allow all proxies when trustedProxies is empty", () => {
    const resolver = createUrlResolver({ trustedProxies: [] });
    const request = {
      protocol: "http",
      ip: "10.0.0.1",
      headers: {
        host: "internal.local",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "public.example.com",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://public.example.com");
    expect(result.isFixed).toBe(false);
  });
});

describe("urlResolver - resolveUrl with fixed baseUrl", () => {
  it("should always return fixed baseUrl", () => {
    const resolver = createUrlResolver({ baseUrl: "https://api.example.com" });
    const request = {
      protocol: "http",
      headers: {
        host: "localhost:3000",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://api.example.com");
    expect(result.isFixed).toBe(true);
  });

  it("should remove trailing slash from fixed baseUrl", () => {
    const resolver = createUrlResolver({ baseUrl: "https://api.example.com/" });
    const request = {
      protocol: "http",
      headers: {},
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://api.example.com");
    expect(result.isFixed).toBe(true);
  });

  it("should ignore X-Forwarded headers when baseUrl is fixed", () => {
    const resolver = createUrlResolver({
      baseUrl: "https://api.example.com",
      trustedProxies: ["192.168.1.1"],
    });
    const request = {
      protocol: "http",
      ip: "192.168.1.1",
      headers: {
        host: "internal.local",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "other.example.com",
      },
      socket: {},
    };

    const result = resolver.resolveUrl(request);
    expect(result.baseUrl).toBe("https://api.example.com");
    expect(result.isFixed).toBe(true);
  });
});

describe("urlResolver - isFixedUrl", () => {
  it("should return true when baseUrl is provided", () => {
    const resolver = createUrlResolver({ baseUrl: "https://api.example.com" });
    expect(resolver.isFixedUrl()).toBe(true);
  });

  it("should return false when baseUrl is not provided", () => {
    const resolver = createUrlResolver();
    expect(resolver.isFixedUrl()).toBe(false);
  });

  it("should return false when baseUrl is empty string", () => {
    const resolver = createUrlResolver({ baseUrl: "" });
    expect(resolver.isFixedUrl()).toBe(false);
  });
});
