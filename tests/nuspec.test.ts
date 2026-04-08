// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect } from 'vitest';
import {
  extractNuspecTargetFrameworks,
  normalizeNuspecTargetFramework,
} from '../src/utils/nuspec';

describe('Nuspec Utilities', () => {
  describe('normalizeNuspecTargetFramework', () => {
    it('should normalize nuspec framework names to canonical TFMs', () => {
      expect(normalizeNuspecTargetFramework('.NET Framework 4.5')).toBe(
        'net45'
      );
      expect(normalizeNuspecTargetFramework('.NETStandard2.0')).toBe(
        'netstandard2.0'
      );
      expect(normalizeNuspecTargetFramework('.NETCoreApp3.1')).toBe(
        'netcoreapp3.1'
      );
      expect(normalizeNuspecTargetFramework('net8.0')).toBe('net8.0');
    });

    it('should preserve normalized fallback values for already short TFMs', () => {
      expect(normalizeNuspecTargetFramework('net40-client')).toBe(
        'net40-client'
      );
      expect(normalizeNuspecTargetFramework('sl4-wp')).toBe('sl4-wp');
    });
  });

  describe('extractNuspecTargetFrameworks', () => {
    it('should extract normalized target frameworks from multiple nuspec sections', () => {
      const metadata = {
        dependencies: {
          group: [
            { $: { targetFramework: '.NETFramework4.5' } },
            { $: { targetFramework: '.NETStandard2.0' } },
          ],
        },
        frameworkReferences: {
          group: { $: { targetFramework: '.NETCoreApp3.1' } },
        },
        frameworkAssemblies: {
          frameworkAssembly: {
            $: { targetFramework: 'net40-client, net40' },
          },
        },
      };

      expect(extractNuspecTargetFrameworks(metadata)).toEqual([
        'net45',
        'netstandard2.0',
        'netcoreapp3.1',
        'net40-client',
        'net40',
      ]);
    });
  });
});
