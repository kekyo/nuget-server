// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, it, expect } from 'vitest';
import {
  extractNuspecTargetFrameworks,
  normalizeNuspecTargetFramework,
  readNuspecIdentity,
} from '../src/utils/nuspec';

describe('Nuspec Utilities', () => {
  describe('readNuspecIdentity', () => {
    it.each([
      '.',
      '..',
      'nested/name',
      'nested\\name',
      '../x',
      'a/../b',
      '..\\x',
      '../../1',
      'C:relative',
      'name\n',
    ])('rejects %j in either storage component', (component) => {
      expect(() => readNuspecIdentity(component, '1.0')).toThrow();
      expect(() => readNuspecIdentity('Example', component)).toThrow();
    });

    it.each(['_Test.Core-2', 'A_B', 'a'.repeat(100)])(
      'retains the spelling of a valid package ID',
      (id) => expect(readNuspecIdentity(id, '1.0').id).toBe(id)
    );

    it.each(['con', 'LPT1.Tools', 'two..words', 'a'.repeat(101)])(
      'rejects an ID unsuitable for a package directory',
      (id) => expect(() => readNuspecIdentity(id, '1.0')).toThrow()
    );

    it.each(['1', '01.2', '1.2.3.4', '1.2.3-RC.2+build.001'])(
      'accepts the NuGet version %s',
      (version) =>
        expect(readNuspecIdentity('A', version).version).toBe(version)
    );

    it.each(['1.', '1.2.3.4.5', '2147483648.0', '1.0-alpha.01', '1.0+'])(
      'rejects the malformed version %s',
      (version) => expect(() => readNuspecIdentity('A', version)).toThrow()
    );
  });

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
