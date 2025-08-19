import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { startServer, ServerInstance } from './helpers/server.js';
import { createTestDirectory, testPackageUpload } from './helpers/package.js';
import { 
  createTestProject, 
  addNuGetSource, 
  runDotNetRestore, 
  checkDotNetAvailable 
} from './helpers/dotnet.js';
import { createConsoleLogger } from '../src/logger.js';

describe('Package Upload', () => {
  let serverPort: number;
  let packagesDir: string;
  let testBaseDir: string;
  let serverInstance: ServerInstance | null = null;
  const logger = createConsoleLogger('PublishTest');

  beforeEach(async fn => {
    serverPort = 3001 + Math.floor(Math.random() * 1000);
    testBaseDir = await createTestDirectory(fn.task.name);
    packagesDir = path.join(testBaseDir, 'packages');
    
    // Create test directory structure
    await fs.mkdir(packagesDir, { recursive: true });
    
    // Start server with test directory
    serverInstance = await startServer(serverPort, testBaseDir);
  });

  afterEach(async () => {
    // Stop server instance
    if (serverInstance) {
      await serverInstance.stop();
      serverInstance = null;
    }
  });

  it('should upload a package successfully', async () => {
    const testPackagePath = path.join(process.cwd(), 'tests/fixtures/upload/NamingFormatter.2.4.0.nupkg');

    const result = await testPackageUpload(
      `http://localhost:${serverPort}/api/publish`,
      testPackagePath
    );

    expect(result.success).toBe(true);
    expect(result.response?.id).toBe('NamingFormatter');
    expect(result.response?.version).toBe('2.4.0');

    // Verify files were created
    const expectedNupkgPath = path.join(packagesDir, 'NamingFormatter', '2.4.0', 'NamingFormatter.2.4.0.nupkg');
    const expectedNuspecPath = path.join(packagesDir, 'NamingFormatter', '2.4.0', 'NamingFormatter.nuspec');
    
    await expect(fs.access(expectedNupkgPath)).resolves.toBeUndefined();
    await expect(fs.access(expectedNuspecPath)).resolves.toBeUndefined();
  });

  it('should reject invalid file uploads', async () => {
    // Create a temporary invalid file
    const invalidFilePath = path.join(testBaseDir, 'test-invalid.txt');
    await fs.writeFile(invalidFilePath, 'This is not a nupkg file');

    try {
      const result = await testPackageUpload(
        `http://localhost:${serverPort}/api/publish`,
        invalidFilePath
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid package format');
    } finally {
      // Cleanup
      await fs.unlink(invalidFilePath).catch(() => {});
    }
  });

  it('should allow dotnet restore after uploading a package', async () => {
    // Check if dotnet CLI is available
    const dotnetAvailable = await checkDotNetAvailable();
    if (!dotnetAvailable) {
      logger.info('Skipping dotnet restore test - dotnet CLI not available');
      return;
    }

    // Step 1: Upload the test package
    const testPackagePath = path.join(process.cwd(), 'tests/fixtures/upload/namingformatter.2.4.0.nupkg');
    
    // Check if test package exists
    try {
      await fs.access(testPackagePath);
    } catch (error) {
      logger.warn('Test package not found, skipping test');
      return;
    }

    const uploadResult = await testPackageUpload(
      `http://localhost:${serverPort}/api/publish`,
      testPackagePath
    );

    expect(uploadResult.success).toBe(true);
    expect(uploadResult.response?.id).toBe('NamingFormatter');
    expect(uploadResult.response?.version).toBe('2.4.0');

    // Step 2: Wait a moment for the server to process the package
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: Create a .NET project that references the uploaded package
    const dotnetDir = path.join(path.dirname(packagesDir), 'dotnet');
    await createTestProject(dotnetDir, 'NamingFormatter', '2.4.0');
    await addNuGetSource(dotnetDir, `http://localhost:${serverPort}/api`);

    // Step 4: Run dotnet restore
    const restoreResult = await runDotNetRestore(dotnetDir);

    if (!restoreResult.success) {
      logger.info(`Restore stdout: ${restoreResult.stdout}`);
      logger.info(`Restore stderr: ${restoreResult.stderr}`);
    }

    // Step 5: Verify restore was successful
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.exitCode).toBe(0);

    logger.info('Package upload and dotnet restore integration test passed');
  }, 90000); // 90 second timeout for this comprehensive test
});
