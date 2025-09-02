// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { Logger } from '../types';

/**
 * Generic request interface for URL resolution
 */
interface GenericRequest {
  protocol: string;
  ip?: string;
  socket: {
    remoteAddress?: string;
  };
  headers: { [key: string]: string | string[] | undefined };
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
 * Extracts path prefix from a base URL
 * @param baseUrl - Base URL to extract path from
 * @returns Path prefix (e.g., "/nuget") or empty string
 */
export const extractPathFromBaseUrl = (baseUrl: string | undefined): string => {
  if (!baseUrl) return '';

  try {
    const url = new URL(baseUrl);
    // Remove trailing slash and return path
    return url.pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
};

/**
 * Creates a URL resolver for handling dynamic/proxy-aware URL generation
 * @param logger - Logger
 * @param config - URL resolver configuration
 * @returns URL resolver instance
 */
export const createUrlResolver = (
  logger: Logger,
  config: UrlResolverConfig = {}
) => {
  const { baseUrl: fixedBaseUrl, trustedProxies = [] } = config;

  /**
   * Checks if a request comes from a trusted proxy
   * @param req - Generic request object
   * @returns True if from trusted proxy, false otherwise
   */
  const isRequestFromTrustedProxy = (req: GenericRequest): boolean => {
    if (trustedProxies.length === 0) {
      logger.debug(`resolveUrl: no trustedProxies`);
      return true;
    }

    const clientIp = req.ip || req.socket.remoteAddress;
    const forwardedFor = req.headers['x-forwarded-for'] as string;

    logger.debug(`resolveUrl: clientIp: ${clientIp}`);
    logger.debug(`resolveUrl: x-forwarded-for: ${forwardedFor}`);

    const sourceIps = [clientIp];
    if (forwardedFor) {
      sourceIps.push(...forwardedFor.split(',').map((ip) => ip.trim()));
    }

    const result = sourceIps.some((ip) => trustedProxies.includes(ip || ''));
    logger.debug(`resolveUrl: trustedProxies: ${result}`);

    return result;
  };

  /**
   * Parses the Forwarded header according to RFC 7239
   * @param forwarded - Forwarded header value
   * @returns Parsed forwarded information
   */
  const parseForwardedHeader = (forwarded: string): Record<string, string> => {
    const parsed: Record<string, string> = {};

    const pairs = forwarded.split(';').map((s) => s.trim());
    for (const pair of pairs) {
      const [key, value] = pair.split('=').map((s) => s.trim());
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
      logger.debug(`resolveUrl: resolved: ${fixedBaseUrl} (fixed)`);
      return {
        baseUrl: fixedBaseUrl.replace(/\/$/, ''),
        isFixed: true,
      };
    }

    let protocol = req.protocol;
    let host = (req.headers.host as string) || 'localhost';
    logger.debug(`resolveUrl: protocol: ${protocol}`);
    logger.debug(`resolveUrl: host: ${host}`);

    let port: string | undefined;

    if (isRequestFromTrustedProxy(req)) {
      const forwardedProto = req.headers['x-forwarded-proto'] as string;
      const forwardedHost = req.headers['x-forwarded-host'] as string;
      const forwardedPort = req.headers['x-forwarded-port'] as string;
      const forwarded = req.headers['forwarded'] as string;

      logger.debug(`resolveUrl: x-forwarded-proto: ${forwardedProto}`);
      logger.debug(`resolveUrl: x-forwarded-host: ${forwardedHost}`);
      logger.debug(`resolveUrl: x-forwarded-port: ${forwardedPort}`);
      logger.debug(`resolveUrl: forwarded: ${forwarded}`);

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

    const hostWithPort = port && !host.includes(':') ? `${host}:${port}` : host;

    const baseUrl = `${protocol}://${hostWithPort}`;
    logger.debug(`resolveUrl: resolved: ${baseUrl}`);

    return {
      baseUrl,
      isFixed: false,
    };
  };

  /**
   * Extracts path prefix from request headers or configuration
   * @param req - Generic request object
   * @returns Path prefix or empty string
   */
  const extractPathPrefix = (req: GenericRequest): string => {
    // First, check if we have a fixed baseUrl with a path
    if (fixedBaseUrl) {
      const pathPrefix = extractPathFromBaseUrl(fixedBaseUrl);
      if (pathPrefix) {
        logger.debug(`extractPathPrefix: from baseUrl: ${pathPrefix}`);
        return pathPrefix;
      }
    }

    // Then check x-forwarded-path header if from trusted proxy
    if (isRequestFromTrustedProxy(req)) {
      const forwardedPath = req.headers['x-forwarded-path'] as string;
      if (forwardedPath) {
        // Remove trailing slash
        const pathPrefix = forwardedPath.replace(/\/$/, '');
        logger.debug(`extractPathPrefix: from x-forwarded-path: ${pathPrefix}`);
        return pathPrefix;
      }
    }

    return '';
  };

  return {
    resolveUrl,
    extractPathPrefix,
    isFixedUrl: (): boolean => !!fixedBaseUrl,
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
 * @returns Array of trusted proxy IPs from NUGET_SERVER_TRUSTED_PROXIES environment variable, or undefined if not set
 */
export const getTrustedProxiesFromEnv = (): string[] | undefined => {
  const proxies = process.env.NUGET_SERVER_TRUSTED_PROXIES;
  if (!proxies) return undefined;

  return proxies
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
};
