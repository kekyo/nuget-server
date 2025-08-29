// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect } from "vitest";
import {
  compareVersions,
  sortVersions,
  getLatestVersion,
} from "../src/utils/semver";

describe("Semantic Version Utilities", () => {
  describe("compareVersions", () => {
    it("should compare major versions correctly", () => {
      expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
      expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("should compare minor versions correctly", () => {
      expect(compareVersions("1.2.0", "1.1.0")).toBeGreaterThan(0);
      expect(compareVersions("1.1.0", "1.2.0")).toBeLessThan(0);
    });

    it("should compare patch versions correctly", () => {
      expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
      expect(compareVersions("1.0.1", "1.0.2")).toBeLessThan(0);
    });

    it("should handle different version part lengths", () => {
      expect(compareVersions("1.0.0.1", "1.0.0")).toBeGreaterThan(0);
      expect(compareVersions("1.0", "1.0.0")).toBe(0); // 1.0 is treated as 1.0.0
    });

    it("should handle prerelease versions correctly", () => {
      expect(compareVersions("1.0.0", "1.0.0-alpha")).toBeGreaterThan(0); // stable > prerelease
      expect(compareVersions("1.0.0-alpha", "1.0.0")).toBeLessThan(0); // prerelease < stable
      expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0); // beta > alpha
    });

    it("should correctly compare the problematic case 1.10.0 vs 1.9.0", () => {
      expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
      expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
    });
  });

  describe("sortVersions", () => {
    it("should sort versions in descending order by default", () => {
      const versions = ["1.0.0", "1.10.0", "1.9.0", "2.0.0", "1.0.0-alpha"];
      const sorted = sortVersions(versions);
      expect(sorted).toEqual([
        "2.0.0",
        "1.10.0",
        "1.9.0",
        "1.0.0",
        "1.0.0-alpha",
      ]);
    });

    it("should sort versions in ascending order when specified", () => {
      const versions = ["1.0.0", "1.10.0", "1.9.0", "2.0.0"];
      const sorted = sortVersions(versions, "asc");
      expect(sorted).toEqual(["1.0.0", "1.9.0", "1.10.0", "2.0.0"]);
    });

    it("should handle complex version numbers", () => {
      const versions = [
        "1.0.0",
        "1.0.0-alpha.1",
        "1.0.0-alpha.2",
        "1.0.0-beta",
        "1.0.1",
      ];
      const sorted = sortVersions(versions);
      expect(sorted).toEqual([
        "1.0.1",
        "1.0.0",
        "1.0.0-beta",
        "1.0.0-alpha.2",
        "1.0.0-alpha.1",
      ]);
    });

    it("should not mutate the original array", () => {
      const versions = ["1.0.0", "2.0.0", "1.5.0"];
      const originalVersions = [...versions];
      sortVersions(versions);
      expect(versions).toEqual(originalVersions);
    });
  });

  describe("getLatestVersion", () => {
    it("should return the latest version from an array", () => {
      const versions = ["1.0.0", "1.10.0", "1.9.0", "2.0.0"];
      expect(getLatestVersion(versions)).toBe("2.0.0");
    });

    it("should handle prerelease versions correctly", () => {
      const versions = ["1.0.0-alpha", "1.0.0", "1.0.0-beta"];
      expect(getLatestVersion(versions)).toBe("1.0.0");
    });

    it("should return undefined for empty array", () => {
      expect(getLatestVersion([])).toBeUndefined();
    });

    it("should handle single version", () => {
      expect(getLatestVersion(["1.0.0"])).toBe("1.0.0");
    });
  });
});
