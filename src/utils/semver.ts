// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Parsed semantic version information
 */
interface ParsedVersion {
  parts: number[];
  prerelease?: string;
}

/**
 * Parses a semantic version string into structured data
 * @param version - Version string (e.g., "1.2.3-alpha.1")
 * @returns Parsed version information
 */
const parseVersion = (version: string): ParsedVersion => {
  const [main, prerelease] = version.split("-");
  const parts = main?.split(".").map(Number) ?? [];
  return { parts, prerelease };
};

/**
 * Compares two semantic versions
 * @param a - First version string
 * @param b - Second version string
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
export const compareVersions = (a: string, b: string): number => {
  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  // Compare main version parts (major.minor.patch)
  for (
    let i = 0;
    i < Math.max(versionA.parts.length, versionB.parts.length);
    i++
  ) {
    const partA = versionA.parts[i] || 0;
    const partB = versionB.parts[i] || 0;

    if (partA !== partB) {
      return partA - partB;
    }
  }

  // If main versions are equal, handle prerelease
  if (versionA.prerelease && !versionB.prerelease) return -1; // prerelease comes before stable
  if (!versionA.prerelease && versionB.prerelease) return 1; // stable comes after prerelease
  if (versionA.prerelease && versionB.prerelease) {
    return versionA.prerelease.localeCompare(versionB.prerelease); // alphabetical for prerelease
  }

  return 0;
};

/**
 * Sorts an array of version strings
 * @param versions - Array of version strings
 * @param order - Sort order: 'asc' for ascending (oldest first), 'desc' for descending (newest first)
 * @returns Sorted array of version strings
 */
export const sortVersions = (
  versions: string[],
  order: "asc" | "desc" = "desc",
): string[] => {
  return [...versions].sort((a, b) => {
    const result = compareVersions(a, b);
    return order === "desc" ? -result : result;
  });
};

/**
 * Gets the latest version from an array of version strings
 * @param versions - Array of version strings
 * @returns The latest version string, or null if array is empty
 */
export const getLatestVersion = (versions: string[]): string | null => {
  if (versions.length === 0) return null;
  const sorted = sortVersions(versions, "desc");
  return sorted[0] ?? null;
};
