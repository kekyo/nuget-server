import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';

export interface DotNetRestoreResult {
  success: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
}

/**
 * Clears all NuGet caches to ensure clean test environment
 * This includes global packages, http cache, temp cache, and plugin cache
 */
export const clearNuGetCache = async (): Promise<void> => {
  try {
    await execa('dotnet', ['nuget', 'locals', 'all', '--clear'], {
      timeout: 30000 // 30 seconds timeout
    });
  } catch (error: any) {
    // Log but don't fail if cache clear fails
    console.warn('Failed to clear NuGet cache:', error.message);
  }
};

export const createTestProject = async (
  dotnetDir: string,
  packageId: string,
  packageVersion: string
): Promise<void> => {
  await fs.ensureDir(dotnetDir);
  
  const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  
  <ItemGroup>
    <PackageReference Include="${packageId}" Version="${packageVersion}" />
  </ItemGroup>
</Project>`;

  const csprojPath = path.join(dotnetDir, 'TestProject.csproj');
  await fs.writeFile(csprojPath, csprojContent);
}

export const addNuGetSource = async (
  dotnetDir: string,
  serverUrl: string
): Promise<void> => {
  const nugetConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="local-nuget-server" value="${serverUrl}/v3/index.json" allowInsecureConnections="true" />
  </packageSources>
</configuration>`;

  const nugetConfigPath = path.join(dotnetDir, 'NuGet.config');
  await fs.writeFile(nugetConfigPath, nugetConfigContent);
}

export const addNuGetSourceWithAuth = async (
  dotnetDir: string,
  serverUrl: string,
  username: string,
  password: string
): Promise<void> => {
  const nugetConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="local-nuget-server" value="${serverUrl}/v3/index.json" allowInsecureConnections="true" />
  </packageSources>
  <packageSourceCredentials>
    <local-nuget-server>
      <add key="Username" value="${username}" />
      <add key="ClearTextPassword" value="${password}" />
    </local-nuget-server>
  </packageSourceCredentials>
</configuration>`;

  const nugetConfigPath = path.join(dotnetDir, 'NuGet.config');
  await fs.writeFile(nugetConfigPath, nugetConfigContent);
}

export const runDotNetRestore = async (projectDir: string): Promise<DotNetRestoreResult> => {
  try {
    const result = await execa('dotnet', ['restore', '--no-cache', '--force', '--verbosity', 'detailed'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60000 // 60 seconds timeout
    });
    
    return {
      success: (result.exitCode ?? 0) === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error: any) {
    return {
      success: false,
      exitCode: error.exitCode ?? 1,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    };
  }
}

export const extractPackageRequestsFromRestoreOutput = (output: string): Array<{
  packageId: string;
  version: string;
  source: string;
}> => {
  const requests: Array<{ packageId: string; version: string; source: string }> = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    // Look for package download patterns in dotnet restore output
    const downloadMatch = line.match(/Installing (.+?) (.+?) from (.+)/);
    if (downloadMatch) {
      const [, packageId, version, source] = downloadMatch;
      requests.push({ packageId, version, source });
      continue;
    }
    
    // Alternative pattern for package resolution
    const resolveMatch = line.match(/Resolved (.+?) (.+?) from (.+)/);
    if (resolveMatch) {
      const [, packageId, version, source] = resolveMatch;
      requests.push({ packageId, version, source });
      continue;
    }
  }
  
  return requests;
}

/**
 * Verifies that a package was actually restored by checking obj/project.assets.json and obj/project.nuget.cache
 * @param projectDir - Directory containing the .NET project
 * @param packageId - Package ID to verify
 * @param version - Package version to verify
 * @returns true if package was successfully restored
 */
export const verifyPackageRestored = async (
  projectDir: string,
  packageId: string,
  version: string
): Promise<boolean> => {
  try {
    // Check project.assets.json for package details
    const assetsPath = path.join(projectDir, 'obj/project.assets.json');
    const assetsContent = await fs.readFile(assetsPath, 'utf-8');
    const assets = JSON.parse(assetsContent);
    
    // Check if package is in libraries section
    const packageKey = `${packageId}/${version}`;
    if (!assets.libraries || !assets.libraries[packageKey]) {
      return false;
    }
    
    // Check project.nuget.cache for restore success
    const cachePath = path.join(projectDir, 'obj/project.nuget.cache');
    const cacheContent = await fs.readFile(cachePath, 'utf-8');
    const cache = JSON.parse(cacheContent);
    
    return cache.success === true;
  } catch (error) {
    // Files don't exist or can't be parsed - restore failed
    return false;
  }
};
