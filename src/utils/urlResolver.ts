// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Generic request interface for URL resolution
 */
interface GenericRequest {
  protocol: string;
  ip?: string;
  socket: {
    remoteAddress?: string;
  };
  get(header: string): string | undefined;
}

/**
 * Configuration for URL resolver
 */
export interface UrlResolverConfig {
  baseUrl?: string;
  trustedProxies?: string[];
}

/**
 * Result of URL resolution
 */
export interface ResolvedUrl {
  baseUrl: string;
  isFixed: boolean;
}

/**
 * Creates a URL resolver for handling dynamic/proxy-aware URL generation
 * @param config - URL resolver configuration
 * @returns URL resolver instance
 */
export const createUrlResolver = (config: UrlResolverConfig = {}) => {
  const { baseUrl: fixedBaseUrl, trustedProxies = [] } = config;

  /**
   * Checks if a request comes from a trusted proxy
   * @param req - Generic request object
   * @returns True if from trusted proxy, false otherwise
   */
  const isRequestFromTrustedProxy = (req: GenericRequest): boolean => {
    if (trustedProxies.length === 0) {
      return true;
    }
    
    const clientIp = req.ip || req.socket.remoteAddress;
    const forwardedFor = req.get('X-Forwarded-For');
    
    const sourceIps = [clientIp];
    if (forwardedFor) {
      sourceIps.push(...forwardedFor.split(',').map(ip => ip.trim()));
    }
    
    return sourceIps.some(ip => trustedProxies.includes(ip || ''));
  };

  /**
   * Parses the Forwarded header according to RFC 7239
   * @param forwarded - Forwarded header value
   * @returns Parsed forwarded information
   */
  const parseForwardedHeader = (forwarded: string): Record<string, string> => {
    const parsed: Record<string, string> = {};
    
    const pairs = forwarded.split(';').map(s => s.trim());
    for (const pair of pairs) {
      const [key, value] = pair.split('=').map(s => s.trim());
      if (key && value) {
        parsed[key.toLowerCase()] = value.replace(/"/g, '');
      }
    }
    
    return parsed;
  };

  /**
   * Resolves the base URL for API endpoints from request headers
   * @param req - Generic request object
   * @returns Resolved URL information
   */
  const resolveUrl = (req: GenericRequest): ResolvedUrl => {
    if (fixedBaseUrl) {
      return {
        baseUrl: fixedBaseUrl.replace(/\/$/, ''),
        isFixed: true
      };
    }

    let protocol = req.protocol;
    let host = req.get('Host') || 'localhost';
    let port: string | undefined;

    if (isRequestFromTrustedProxy(req)) {
      const forwardedProto = req.get('X-Forwarded-Proto');
      const forwardedHost = req.get('X-Forwarded-Host');
      const forwardedPort = req.get('X-Forwarded-Port');
      const forwarded = req.get('Forwarded');

      if (forwarded) {
        const parsed = parseForwardedHeader(forwarded);
        if (parsed.proto) protocol = parsed.proto;
        if (parsed.host) host = parsed.host;
        if (parsed.port) port = parsed.port;
      } else {
        if (forwardedProto) protocol = forwardedProto;
        if (forwardedHost) host = forwardedHost;
        if (forwardedPort) port = forwardedPort;
      }
    }

    const hostWithPort = port && !host.includes(':') 
      ? `${host}:${port}`
      : host;

    return {
      baseUrl: `${protocol}://${hostWithPort}/api`,
      isFixed: false
    };
  };

  return {
    resolveUrl,
    isFixedUrl: (): boolean => !!fixedBaseUrl
  };
};

/**
 * Gets base URL from environment variable
 * @returns Base URL from NUGET_SERVER_BASE_URL environment variable
 */
export const getBaseUrlFromEnv = (): string | undefined => {
  return process.env.NUGET_SERVER_BASE_URL;
};

/**
 * Gets trusted proxies list from environment variable
 * @returns Array of trusted proxy IPs from NUGET_SERVER_TRUSTED_PROXIES environment variable
 */
export const getTrustedProxiesFromEnv = (): string[] => {
  const proxies = process.env.NUGET_SERVER_TRUSTED_PROXIES;
  if (!proxies) return [];
  
  return proxies.split(',').map(ip => ip.trim()).filter(Boolean);
};