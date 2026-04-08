import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { describe, it, expect } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), 'build-docker-multiplatform.sh');
const dockerfilePath = path.join(process.cwd(), 'Dockerfile');

describe('build-docker-multiplatform.sh', () => {
  it('should be valid bash syntax', async () => {
    await execFileAsync('bash', ['-n', scriptPath]);
  });

  it('should expose verification options in help', async () => {
    const { stdout } = await execFileAsync('bash', [scriptPath, '--help']);

    expect(stdout).toContain('--jobs JOBS');
    expect(stdout).toContain('--node-image IMAGE');
    expect(stdout).toContain('--skip-target-verify');
    expect(stdout).toContain('--skip-host-smoke');
    expect(stdout).toContain('--skip-verify');
    expect(stdout).toContain('BUILD_JOBS');
    expect(stdout).toContain('NODE_IMAGE');
    expect(stdout).toContain('VERIFY_TARGET_PLATFORMS');
    expect(stdout).toContain('VERIFY_HOST_IMAGE');
  });

  it('should verify QEMU with a Debian-based image', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain(
      'QEMU_CHECK_IMAGE="${QEMU_CHECK_IMAGE:-docker.io/library/debian:trixie-slim}"'
    );
    expect(script).not.toContain('alpine:latest');
  });

  it('should load sodium-native during binary verification', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain(
      "require('sodium-native'); require('@fastify/secure-session');"
    );
  });

  it('should use qualified localhost names for local Podman images', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain(
      'LOCAL_IMAGE="localhost/${IMAGE_NAME}:${VERSION}"'
    );
    expect(script).toContain('LOCAL_LATEST="localhost/${IMAGE_NAME}:latest"');
    expect(script).toContain(
      'podman manifest add "${MANIFEST_NAME}" "containers-storage:${platform_image}"'
    );
  });

  it('should support configuring up to two parallel platform builds', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain('BUILD_JOBS="${BUILD_JOBS:-1}"');
    expect(script).toContain('BUILD_JOBS must be between 1 and 2');
    expect(script).toContain('-j|--jobs');
    expect(script).toContain(
      'build_platform_image "$platform" "$platform_image" &'
    );
  });

  it('should allow overriding the base Node image', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain('NODE_IMAGE="${NODE_IMAGE:-node:24-trixie-slim}"');
    expect(script).toContain('--node-image');
    expect(script).toContain('--build-arg "NODE_IMAGE=${NODE_IMAGE}"');
    expect(script).toContain('--node-image node:22-bookworm-slim');
  });
});

describe('Dockerfile', () => {
  it('should use a configurable Debian-based Node image', async () => {
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    expect(dockerfile).toContain('ARG NODE_IMAGE=node:24-trixie-slim');
    expect(dockerfile).toContain('FROM ${NODE_IMAGE} AS builder');
    expect(dockerfile).toContain('FROM ${NODE_IMAGE} AS runtime');
    expect(dockerfile).not.toContain('node:20-alpine');
  });

  it('should not contain Alpine-specific sodium-native build steps', async () => {
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    expect(dockerfile).not.toContain('apk add');
    expect(dockerfile).not.toContain('linux-${ARCH}-musl');
    expect(dockerfile).not.toContain(
      "find node_modules -type f -path '*/sodium-native/CMakeLists.txt'"
    );
  });

  it('should use the health endpoint for container health checks', async () => {
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    expect(dockerfile).toContain("fetch('http://localhost:5963/health')");
  });
});
