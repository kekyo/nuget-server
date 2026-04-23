import { describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

interface PackageManifest {
  readonly bin?: Record<string, string>;
  readonly main?: unknown;
  readonly module?: unknown;
  readonly types?: unknown;
  readonly exports?: unknown;
}

const projectRoot = process.cwd();

const readPackageManifest = async (): Promise<PackageManifest> => {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageJson = await fs.readFile(packageJsonPath, 'utf-8');
  return JSON.parse(packageJson) as PackageManifest;
};

const collectFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }
      return [path.relative(projectRoot, fullPath)];
    })
  );
  return files.flat();
};

describe('package public surface', () => {
  test('should expose only the CLI executable from package metadata', async () => {
    const manifest = await readPackageManifest();

    expect(manifest.bin).toEqual({
      'nuget-server': './dist/cli.mjs',
    });
    expect(manifest).not.toHaveProperty('main');
    expect(manifest).not.toHaveProperty('module');
    expect(manifest).not.toHaveProperty('types');
    expect(manifest).not.toHaveProperty('exports');
  });

  test('should not emit library entry points or declarations', async () => {
    const distPath = path.join(projectRoot, 'dist');
    const files = await collectFiles(distPath);

    expect(files).toContain('dist/cli.mjs');
    expect(files).not.toContain('dist/index.mjs');
    expect(files).not.toContain('dist/index.cjs');
    expect(files).not.toContain('dist/index.d.ts');
    expect(files.filter((file) => file.endsWith('.d.ts'))).toEqual([]);
    expect(files.filter((file) => file.endsWith('.d.ts.map'))).toEqual([]);
  });
});
