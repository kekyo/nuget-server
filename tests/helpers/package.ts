import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConsoleLogger } from '../../src/logger.js';

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
            nupkgPath: path.join(artifactsDir, file)
          });
        }
      }
    }
  } catch (error) {
    logger.warn(`Could not read artifacts directory: ${error}`);
  }
  
  return packages;
}

export const extractNuspecFromNupkg = async (nupkgPath: string, targetDir: string, packageId: string): Promise<void> => {
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
}

export const setupPackageStorage = async (testDir: string): Promise<void> => {
  const packagesDir = path.join(testDir, 'packages');
  await fs.ensureDir(packagesDir);
  
  const availablePackages = await getAvailablePackages();
  
  for (const pkg of availablePackages) {
    const packageDir = path.join(packagesDir, pkg.id, pkg.version);
    await fs.ensureDir(packageDir);
    
    // Copy nupkg file
    const targetNupkgPath = path.join(packageDir, `${pkg.id}.${pkg.version}.nupkg`);
    await fs.copy(pkg.nupkgPath, targetNupkgPath);
    
    // Extract and save nuspec file
    try {
      await extractNuspecFromNupkg(pkg.nupkgPath, packageDir, pkg.id);
    } catch (error) {
      logger.warn(`Failed to extract nuspec for ${pkg.id} ${pkg.version}: ${error}`);
    }
  }
  
  logger.info(`Set up package storage with ${availablePackages.length} packages in ${packagesDir}`);
}

export const parsePackageFromNupkgName = (filename: string): { id: string; version: string } | null => {
  const match = filename.match(/^(.+?)\.(\d+\.\d+\.\d+)\.nupkg$/);
  if (match) {
    const [, id, version] = match;
    return { id, version };
  }
  return null;
}

export interface TestPackageMetadata {
  authors?: string;
  description?: string;
  tags?: string[];
  licenseUrl?: string;
  projectUrl?: string;
  iconUrl?: string;
}

export const createTestPackage = async (
  id: string, 
  version: string, 
  metadata?: TestPackageMetadata
): Promise<Buffer> => {
  const zip = new AdmZip();
  
  // Create a simple nuspec file
  const nuspecContent = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>${id}</id>
    <version>${version}</version>
    <authors>${metadata?.authors || 'Test Author'}</authors>
    <description>${metadata?.description || 'Test package description'}</description>
    ${metadata?.licenseUrl ? `<licenseUrl>${metadata.licenseUrl}</licenseUrl>` : ''}
    ${metadata?.projectUrl ? `<projectUrl>${metadata.projectUrl}</projectUrl>` : ''}
    ${metadata?.iconUrl ? `<iconUrl>${metadata.iconUrl}</iconUrl>` : ''}
    ${metadata?.tags ? `<tags>${metadata.tags.join(' ')}</tags>` : ''}
  </metadata>
</package>`;

  // Add nuspec file to zip
  zip.addFile(`${id}.nuspec`, Buffer.from(nuspecContent, 'utf-8'));
  
  // Add a dummy content file
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/packaging/2010/07/manifest" Target="/${id}.nuspec" Id="R0" />
</Relationships>`, 'utf-8'));

  // Add package manifest
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="nuspec" ContentType="application/octet" />
</Types>`, 'utf-8'));

  return zip.toBuffer();
}

export const publishTestPackage = async (baseUrl: string, packageBuffer: Buffer): Promise<void> => {
  const response = await fetch(`${baseUrl}/api/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': packageBuffer.length.toString()
    },
    body: new Uint8Array(packageBuffer)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to publish package: ${response.status} ${errorText}`);
  }
}

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

export const testPackageUpload = async (publishUrl: string, packagePath: string): Promise<PackageUploadResult> => {
  try {
    // Read the package file
    const packageBuffer = await fs.readFile(packagePath);

    // Make HTTP request with simply binary data
    const response = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': packageBuffer.length.toString()
      },
      body: new Uint8Array(packageBuffer)
    });

    const responseText = await response.text();
    
    if (response.ok) {
      const jsonResponse = JSON.parse(responseText);
      return {
        success: true,
        response: jsonResponse
      };
    } else {
      let errorMessage: string;
      try {
        const errorResponse = JSON.parse(responseText);
        errorMessage = errorResponse.error || errorResponse.message || 'Unknown error';
      } catch {
        errorMessage = responseText || 'Unknown error';
      }
      
      return {
        success: false,
        error: errorMessage,
        statusCode: response.status
      };
    }
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
