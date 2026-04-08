// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, expect, test } from 'vitest';
import {
  filterPackages,
  type PackageFilterTarget,
} from '../src/ui/packageFilter';

const packages: PackageFilterTarget[] = [
  {
    id: 'TargetFrameworkPackage',
    description: 'Package with multiple target frameworks',
    tags: ['framework'],
    authors: ['Framework Author'],
    targetFrameworks: ['net8.0', 'netstandard2.0'],
    versions: [{ version: '1.0.0' }],
    license: 'MIT',
  },
  {
    id: 'LicensePackage',
    description: 'Package with SPDX license expression',
    tags: ['license'],
    authors: ['License Author'],
    targetFrameworks: ['net48'],
    versions: [{ version: '2.0.0' }],
    license: 'Apache-2.0',
  },
];

describe('package filter', () => {
  test('should match packages by target framework', () => {
    const filtered = filterPackages(packages, 'net8.0');

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('TargetFrameworkPackage');
  });

  test('should match packages by SPDX license expression', () => {
    const filtered = filterPackages(packages, 'apache-2.0');

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('LicensePackage');
  });

  test('should require all filter terms to match across searchable fields', () => {
    const filtered = filterPackages(packages, 'net48 apache-2.0');

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('LicensePackage');
  });
});
