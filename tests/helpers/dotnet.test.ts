import { describe, expect, test } from 'vitest';
import path from 'path';
import { createDotNetEnvironment } from './dotnet';

describe('dotnet helper', () => {
  test('should isolate NuGet local resource paths under the project directory', () => {
    const projectDir = path.join('tmp', 'dotnet-project');
    const environment = createDotNetEnvironment(projectDir);
    const nugetBasePath = path.join(projectDir, '.nuget');

    expect(environment.nugetPackagesPath).toBe(
      path.join(nugetBasePath, 'packages')
    );
    expect(environment.nugetHttpCachePath).toBe(
      path.join(nugetBasePath, 'http-cache')
    );
    expect(environment.nugetScratchPath).toBe(
      path.join(nugetBasePath, 'scratch')
    );
    expect(environment.nugetPluginsCachePath).toBe(
      path.join(nugetBasePath, 'plugins-cache')
    );
    expect(environment.env.NUGET_PACKAGES).toBe(environment.nugetPackagesPath);
    expect(environment.env.NUGET_HTTP_CACHE_PATH).toBe(
      environment.nugetHttpCachePath
    );
    expect(environment.env.NUGET_SCRATCH).toBe(environment.nugetScratchPath);
    expect(environment.env.NUGET_PLUGINS_CACHE_PATH).toBe(
      environment.nugetPluginsCachePath
    );
  });

  test('should not override NuGet local resource paths without a project directory', () => {
    const environment = createDotNetEnvironment(undefined);

    expect(environment.nugetPackagesPath).toBeUndefined();
    expect(environment.nugetHttpCachePath).toBeUndefined();
    expect(environment.nugetScratchPath).toBeUndefined();
    expect(environment.nugetPluginsCachePath).toBeUndefined();
    expect(environment.env.NUGET_PACKAGES).toBeUndefined();
    expect(environment.env.NUGET_HTTP_CACHE_PATH).toBeUndefined();
    expect(environment.env.NUGET_SCRATCH).toBeUndefined();
    expect(environment.env.NUGET_PLUGINS_CACHE_PATH).toBeUndefined();
  });
});
