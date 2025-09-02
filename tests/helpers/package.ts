import AdmZip from 'adm-zip';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConsoleLogger } from '../../src/logger.js';
import { ensureDir, copy } from './fs-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createConsoleLogger('PackageHelper');

export interface PackageInfo {
  id: string;
  version: string;
  nupkgPath: string;
}

export const getAvailablePackages = async (): Promise<PackageInfo[]> => {
  const artifactsDir = path.resolve(__dirname, '../fixtures/packages');
  const packages: PackageInfo[] = [];

  try {
    const files = await fs.readdir(artifactsDir);

    for (const file of files) {
      if (file.endsWith('.nupkg')) {
        const match = file.match(/^(.+?)\.(\d+\.\d+\.\d+)\.nupkg$/);
        if (match) {
          const [, id, version] = match;
          packages.push({
            id,
            version,
            nupkgPath: path.join(artifactsDir, file),
          });
        }
      }
    }
  } catch (error) {
    logger.warn(`Could not read artifacts directory: ${error}`);
  }

  return packages;
};

export const extractNuspecFromNupkg = async (
  nupkgPath: string,
  targetDir: string,
  packageId: string
): Promise<void> => {
  const zip = new AdmZip(nupkgPath);
  const entries = zip.getEntries();

  for (const entry of entries) {
    if (entry.entryName.endsWith('.nuspec') && !entry.entryName.includes('/')) {
      // Extract the nuspec file to target directory with normalized name
      const nuspecContent = entry.getData();
      const normalizedFileName = `${packageId}.nuspec`;
      const targetPath = path.join(targetDir, normalizedFileName);

      await fs.writeFile(targetPath, nuspecContent);
      return;
    }
  }

  throw new Error(`No nuspec file found in ${nupkgPath}`);
};

export const setupPackageStorage = async (testDir: string): Promise<void> => {
  const packagesDir = path.join(testDir, 'packages');
  await ensureDir(packagesDir);

  const availablePackages = await getAvailablePackages();

  for (const pkg of availablePackages) {
    const packageDir = path.join(packagesDir, pkg.id, pkg.version);
    await ensureDir(packageDir);

    // Copy nupkg file
    const targetNupkgPath = path.join(
      packageDir,
      `${pkg.id}.${pkg.version}.nupkg`
    );
    await copy(pkg.nupkgPath, targetNupkgPath);

    // Extract and save nuspec file
    try {
      await extractNuspecFromNupkg(pkg.nupkgPath, packageDir, pkg.id);
    } catch (error) {
      logger.warn(
        `Failed to extract nuspec for ${pkg.id} ${pkg.version}: ${error}`
      );
    }
  }

  logger.info(
    `Set up package storage with ${availablePackages.length} packages in ${packagesDir}`
  );
};

export const parsePackageFromNupkgName = (
  filename: string
): { id: string; version: string } | null => {
  const match = filename.match(/^(.+?)\.(\d+\.\d+\.\d+)\.nupkg$/);
  if (match) {
    const [, id, version] = match;
    return { id, version };
  }
  return null;
};

export const publishTestPackage = async (
  baseUrl: string,
  packageBuffer: Buffer
): Promise<void> => {
  const response = await fetch(`${baseUrl}/api/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': packageBuffer.length.toString(),
    },
    body: new Uint8Array(packageBuffer),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to publish package: ${response.status} ${errorText}`
    );
  }
};

export interface PackageUploadResult {
  success: boolean;
  response?: {
    message: string;
    id: string;
    version: string;
  };
  error?: string;
  statusCode?: number;
}

export const testPackageUpload = async (
  publishUrl: string,
  packagePath: string
): Promise<PackageUploadResult> => {
  try {
    // Read the package file
    const packageBuffer = await fs.readFile(packagePath);

    // Make HTTP request with simply binary data
    const response = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': packageBuffer.length.toString(),
      },
      body: new Uint8Array(packageBuffer),
    });

    const responseText = await response.text();

    if (response.ok) {
      const jsonResponse = JSON.parse(responseText);
      return {
        success: true,
        response: jsonResponse,
      };
    } else {
      let errorMessage: string;
      try {
        const errorResponse = JSON.parse(responseText);
        errorMessage =
          errorResponse.error || errorResponse.message || 'Unknown error';
      } catch {
        errorMessage = responseText || 'Unknown error';
      }

      return {
        success: false,
        error: errorMessage,
        statusCode: response.status,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
