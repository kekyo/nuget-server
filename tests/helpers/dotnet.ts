import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { Logger } from '../../src/types';

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
export const clearNuGetCache = async (logger: Logger): Promise<void> => {
  try {
    // Check if dotnet command is available first
    const dotnetPath = process.env.HOME ? `${process.env.HOME}/.dotnet` : '/usr/local/share/dotnet';
    const env = {
      ...process.env,
      PATH: `${dotnetPath}:${process.env.PATH || ''}`,
      DOTNET_ROOT: dotnetPath
    };
    
    await execa('dotnet', ['nuget', 'locals', 'all', '--clear'], {
      timeout: 30000, // 30 seconds timeout
      env,
      extendEnv: true
    });
    logger.info('NuGet cache cleared successfully');
  } catch (error: any) {
    // Log detailed error information but don't fail the test
    logger.warn(`Failed to clear NuGet cache: ${error.message}, ${error.exitCode}, ${error.command}, ${error.stdout}, ${error.stderr}`);
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
    <DisableImplicitFrameworkReferences>true</DisableImplicitFrameworkReferences>
    <DisableImplicitNuGetFallbackFolder>true</DisableImplicitNuGetFallbackFolder>
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
  // WARNING: DO NOT REMOVE `<clear />`, we MUST test on only local-nuget-server.
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
  // WARNING: DO NOT REMOVE `<clear />`, we MUST test on only local-nuget-server.
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

export const runDotNetRestore = async (logger: Logger, projectDir: string): Promise<DotNetRestoreResult> => {
  try {
    // Set up environment variables for dotnet CLI
    const dotnetPath = process.env.HOME ? `${process.env.HOME}/.dotnet` : '/usr/local/share/dotnet';
    const env = {
      ...process.env,
      PATH: `${dotnetPath}:${process.env.PATH || ''}`,
      DOTNET_ROOT: dotnetPath,
      DOTNET_CLI_TELEMETRY_OPTOUT: '1', // Disable telemetry for cleaner output
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1'
    };

    // Log debug information
    logger.info(`Running dotnet restore with environment: ${projectDir}, ${dotnetPath}, ${env.PATH?.substring(0, 200)}...`);

    // First check if dotnet is available
    try {
      const versionResult = await execa('dotnet', ['--version'], { env, extendEnv: true, timeout: 10000 });
      logger.info('dotnet version:' + versionResult.stdout);
    } catch (versionError) {
      logger.warn('dotnet version check failed: ' + versionError);
    }

    const result = await execa('dotnet', ['restore', '--no-cache', '--force', '--verbosity', 'normal'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60000, // 60 seconds timeout
      env,
      extendEnv: true
    });
    
    return {
      success: (result.exitCode ?? 0) === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error: any) {
    // Log detailed error information
    logger.info(`dotnet restore failed: ${error.message}, ${error.exitCode}, ${error.command}, ${projectDir}, ${error.stdout || 'No stdout'}, ${error.stderr || 'No stderr'}`);

    return {
      success: false,
      exitCode: error.exitCode ?? 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || 'Unknown error'
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
