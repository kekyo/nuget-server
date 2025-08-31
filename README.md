# nuget-server

Simple modenized NuGet server implementation on Node.js

![nuget-server](images/nuget-server-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/nuget-server.svg)](https://www.npmjs.com/package/nuget-server)
[![Docker Image Version](https://img.shields.io/docker/v/kekyo/nuget-server.svg?label=docker)](https://hub.docker.com/r/kekyo/nuget-server)

---

## What is this?

A simple NuGet server implementation built on Node.js that provides essential NuGet v3 API endpoints.

Compatible with `dotnet restore` and standard NuGet clients for package publishing, querying, and downloading.

A modern browser-based UI is also provided:

- You can refer to registered packages. You can check various package attributes.
- You can download packages by version.
- You can also publish (upload) packages.
- You can manage user accounts.

**Browse package list:**

![Browse package list](images/nuget-server-ss-1.png)

**Publishing packages:**

![Publishing packages](images/nuget-server-ss-2.png)

**User account managements:**

![User account managements](images/nuget-server-ss-3.png)

### Key Features

- **Easy setup, run NuGet server in 10 seconds!**
- NuGet V3 API compatibility: Support for modern NuGet client operations
- No need database management: Store package file and nuspecs into filesystem directly, feel free any database managements
- Package publish: Flexible client to upload `.nupkg` files via `HTTP POST` using cURL and others
- Basic authentication: Setup authentication for publish and general access when you want it
- Reverse proxy support: Configurable trusted reverse proxy handling for proper URL resolution
- Modern Web UI with enhanced features:
  - Multiple package upload: Drag & drop multiple .nupkg files at once
  - User account management: Add/delete users, reset passwords (admin only)
  - API password regeneration: Self-service API password updates
  - Password change: Users can change their own passwords
- Package importer: Included package importer from existing NuGet server
- Docker image available

## Installation

```bash
npm install -g nuget-server
```

## Usage

```bash
# Start server on default port 5963
nuget-server

# Custom port
nuget-server --port 3000

# Multiple options
nuget-server --port 3000 --config-file ./my-config.json --users-file ./data/users.json
```

The NuGet V3 API is served on the `/v3` path.

- Default nuget-server served URL (Show UI): `http://localhost:5963`
- Actual NuGet V3 API endpoint: `http://localhost:5963/v3/index.json`

Default nuget-server served URL can change with `--base-url` option, it shows below section.

## Configure the NuGet client

### Add nuget-server as package source

Add as package source:

```bash
dotnet nuget add source http://localhost:5963/v3/index.json \
  -n "local" --allow-insecure-connections
```

Or specify in `nuget.config`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="local" value="http://localhost:5963/v3/index.json"
      allowInsecureConnections="true" />
  </packageSources>
</configuration>
```

### Publish packages

Upload packages by `HTTP POST` method, using cURL or any HTTP client with `/api/publish` endpoint:

```bash
# Upload "MyPackage.1.0.0.nupkg" file
curl -X POST http://localhost:5963/api/publish \
  --data-binary @MyPackage.1.0.0.nupkg \
  -H "Content-Type: application/octet-stream"
```

This methodology uses simply HTTP POST with binary (octet-stream) instead of the standard NuGet V3 publish protocol (`dotnet nuget push` command), because it is gateway,reverse-proxy,load-balancer friendy access.

## Package storage configuration

### Storage location

By default, packages are stored in the `./packages` directory relative to where you run nuget-server.
You can customize this location using the `--package-dir` option:

```bash
# Use default ./packages directory
nuget-server

# Use custom directory (relative or absolute path)
nuget-server --package-dir /another/package/location
```

### Package storage layout

Packages are stored in the filesystem using the following structure:

```
packages/
├── PackageName/
│   ├── 1.0.0/
│   │   ├── PackageName.1.0.0.nupkg
│   │   ├── PackageName.nuspec
│   │   └── icon.png            # Package icon (if present)
│   └── 2.0.0/
│       ├── PackageName.2.0.0.nupkg
│       ├── PackageName.nuspec
│       └── icon.jpg            # Package icon (if present)
└── AnotherPackage/
    └── 1.5.0/
        ├── AnotherPackage.1.5.0.nupkg
        ├── AnotherPackage.nuspec
        └── icon.png            # Package icon (if present)
```

### Backup and restore

You can backup the package directory using simply `tar` or other achiver:

```bash
cd /your/server/base/dir
tar -cf - ./packages | lz4 > backup-packages.tar.lz4
```

Restore is simply extract it and re-run nuget-server with the same package directory configuration.

---

## Configuration file

You can specify a custom configuration file:

```bash
# Using command line option
nuget-server --config-file /path/to/config.json
# or short alias
nuget-server -c /path/to/config.json

# Using environment variable
export NUGET_SERVER_CONFIG_FILE=/path/to/config.json
nuget-server
```

If not specified, nuget-server looks for `./config.json` in the current directory.

## Configuration file structure

nuget-server supports configuration through a JSON file. This provides an alternative to command-line options and environment variables.

### Configuration priority

Settings are applied in the following order (highest to lowest priority):

1. Command-line options
2. Environment variables
3. config.json
4. Default values

### config.json structure

Create a `config.json` file:

```json
{
  "port": 5963,
  "baseUrl": "http://localhost:5963",
  "packageDir": "./packages",
  "usersFile": "./users.json",
  "realm": "Awsome nuget-server",
  "logLevel": "info",
  "trustedProxies": ["127.0.0.1", "::1"],
  "authMode": "none",
  "sessionSecret": "<your-secret-here>",
  "passwordMinScore": 2,
  "passwordStrengthCheck": true
}
```

All fields are optional. Only include the settings you want to override.
Both `packageDir` and `usersFile` paths can be absolute or relative. If relative, they are resolved from the directory containing the config.json file.

## JSON-based authentication with --auth-init

In addition to htpasswd authentication, nuget-server also supports JSON-based authentication with role management.

### Initialize with --auth-init

Create an initial admin user interactively:

```bash
nuget-server --auth-init --config-file ./config.json
```

This command will:

1. Prompt for admin username (default: admin)
2. Prompt for password (with strength checking, masked input)
3. Generate an API password for the admin user
4. Create `users.json` in the config directory
5. Exit after initialization (server does not start)

### Non-interactive mode (CI/CD)

For automated deployments, you can provide credentials via environment variables:

```bash
export NUGET_SERVER_ADMIN_USERNAME=admin
export NUGET_SERVER_ADMIN_PASSWORD=MySecurePassword123!
nuget-server --auth-init --config-file ./config.json
```

This allows initialization in CI/CD pipelines without user interaction.

### Example session

```
Initializing authentication...
Enter admin username [admin]:
Enter password: ****
Confirm password: ****

============================================================
Admin user created successfully!
============================================================
Username: admin
Password: *********************
API password: ngs_xxxxxxxxxxxxxxxxxxxxxx
============================================================

IMPORTANT: Save this API password securely. It cannot be retrieved again.
Use this API password for NuGet client authentication:
Example register: dotnet nuget add source "http://localhost:5963/v3/index.json"
  -n ref1 -u admin -p ngs_xxxxxxxxxxxxxxxxxxxxxx
  --store-password-in-clear-text --allow-insecure-connections
============================================================
```

## Import packages from another NuGet server with --import-packages

Import all packages from another NuGet server to your local nuget-server instance.

### Initialize package import

Import packages interactively:

```bash
nuget-server --import-packages --package-dir ./packages
```

This command will:

1. Prompt for source NuGet server URL
2. Ask if authentication is required
3. If needed, prompt for username and password (masked input)
4. Discover all packages from the source server
5. Download and import all packages to local storage
6. Display progress for each package (1% intervals)
7. Exit after import (server does not start)

### Non-interactive mode (CI/CD)

For automated deployments, you can provide parameters via environment variables:

```bash
export NUGET_SERVER_IMPORT_SOURCE_URL=https://source.example.com/repository/nuget/
export NUGET_SERVER_IMPORT_USERNAME=reader
export NUGET_SERVER_IMPORT_PASSWORD=MyPassword123
nuget-server --import-packages --package-dir ./packages
```

This allows package import in CI/CD pipelines without user interaction.

### Example session

```
Starting package import...
Enter source NuGet server URL [http://host.example.com/repository/nuget/]: https://nexus.example.com/repository/nuget/
Does the server require authentication? [y/N]: y
Enter username: reader
Enter password: ****

============================================================
Import Configuration:
Source: https://nexus.example.com/repository/nuget/
Target: ./packages
Authentication: reader (password hidden)
============================================================

Start importing packages? (existing packages will be overwritten) [y/N]: y

Discovering packages from source server...
Found 125 packages with 563 versions total.
Starting package import...
Progress: 100/563 packages (17%) - MyPackage.Core@1.2.3
Progress: 563/563 packages (100%) - AnotherPackage@2.0.0

============================================================
Import Complete!
============================================================
Total packages: 125
Total versions: 563
Successfully imported: 563
Failed: 0
Time elapsed: 125.3 seconds
============================================================
```

### Import behavior

- Existing packages with the same version will be overwritten
- Failed imports are logged with error details
- Progress is reported at 1% intervals to reduce log noise
- Package icons are preserved during import

## Authentication modes

When using JSON-based authentication, configure the mode with `--auth-mode`:

- `none`: No authentication required (default)
- `publish`: Authentication required only for package publishing
- `full`: Authentication required for all operations

### Using the API password

After initialization, use the generated API password with NuGet clients:

```bash
# Add source with API password
dotnet nuget add source http://localhost:5963/v3/index.json \
  -n "local" \
  -u admin \
  -p ngs_xxxxxxxxxxxxxxxxxxxxxx \
  --store-password-in-clear-text --allow-insecure-connections
```

Or specify `nuget.config` with credentials:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="local" value="http://localhost:5963/v3/index.json"
      allowInsecureConnections="true" />
  </packageSources>
  <packageSourceCredentials>
    <local>
      <add key="Username" value="reader" />
      <add key="ClearTextPassword" value="your-password" />
    </local>
  </packageSourceCredentials>
</configuration>
```

For package publishing:

```bash
# Publish packages with API password
curl -X POST http://localhost:5963/api/publish \
  -u admin:ngs_xxxxxxxxxxxxxxxxxxxxxx \
  --data-binary @MyPackage.1.0.0.nupkg \
  -H "Content-Type: application/octet-stream"
```

Note: The `users.json` file should be protected with appropriate file permissions and never committed to version control.

### Password strength requirements

nuget-server uses the `zxcvbn` library to enforce strong password requirements:

- Evaluates password strength on a scale of 0-4 (Weak to Very Strong)
- Default minimum score: 2 (Good)
- Checks against common passwords, dictionary words, and patterns
- Provides real-time feedback during password creation

Configure password requirements in `config.json`:

```json
{
  "passwordMinScore": 2, // 0-4, default: 2 (Good)
  "passwordStrengthCheck": true // default: true
}
```

## Reverse proxy interoperability

The server supports running behind reverse proxies with proper URL resolution.

The server resolves URLs using the following priority order:

1. Fixed base URL (highest priority): When `--base-url` option is specified, it always takes precedence
2. Trusted proxy headers: When trusted proxies are configured with `--trusted-proxies`:
   - RFC 7239 compliant `Forwarded` header (proto, host, port)
   - Traditional `X-Forwarded-*` headers (`X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`)
3. Standard request information (fallback): Uses `Host` header when proxy headers are not available

For example `--base-url` option:

- nuget-server served public base URL: `https://packages.example.com`
- Actual NuGet V3 API endpoint: `https://packages.example.com/v3/index.json`

```bash
# Configure served URL (do not include /api path)
nuget-server --base-url https://packages.example.com
```

Another option, you can configure with trusted proxy addresses:

```bash
# Configure trusted proxies for proper host header handling
nuget-server --trusted-proxies "10.0.0.1,192.168.1.100"
```

Environment variables are also supported:

```bash
export NUGET_SERVER_BASE_URL=https://packages.example.com
export NUGET_SERVER_TRUSTED_PROXIES=10.0.0.1,192.168.1.100
export NUGET_SERVER_CONFIG_FILE=/path/to/config.json
export NUGET_SERVER_USERS_FILE=/path/to/users.json
export NUGET_SERVER_SESSION_SECRET=your-secret-key-here
```

### Security Configuration

#### Session Security

For production deployments, always set a secure session secret:

```bash
export NUGET_SERVER_SESSION_SECRET=$(openssl rand -base64 32)
nuget-server
```

(Or use `config.json`.)

If not set, a random secret is generated (warning will be logged). The session secret is crucial for securing web UI sessions.

## Supported NuGet V3 API endpoints

The server implements a subset of the NuGet V3 API protocol:

- Service index: `/v3/index.json`
- Package content: `/v3/package/{id}/index.json`
- Package downloads: `/v3/package/{id}/{version}/{filename}`
- Registration index: `/v3/registrations/{id}/index.json`

---

## Docker usage

Docker images are available for multiple architectures:

- `linux/amd64` (x86_64)
- `linux/arm64` (aarch64)

When pulling the image, Docker automatically selects the appropriate architecture for your platform.

### Quick start

```bash
# Pull and run the latest version
docker run -d -p 5963:5963 -v $(pwd)/packages:/packages kekyo/nuget-server:latest

# Or with Docker Compose
cat > docker-compose.yml << EOF
version: '3'
services:
  nuget-server:
    image: kekyo/nuget-server:latest
    ports:
      - "5963:5963"
    volumes:
      - ./packages:/packages
      - ./config:/config
    environment:
      - NUGET_SERVER_AUTH_MODE=none
EOF

docker-compose up -d
```

Your NuGet server is now available at:
- Web UI: `http://localhost:5963`
- NuGet V3 API: `http://localhost:5963/v3/index.json`

### Basic usage

```bash
# Run with default settings (port 5963, packages stored in mounted volume)
docker run -p 5963:5963 -v $(pwd)/packages:/packages nuget-server:latest

# With authentication configuration directory
docker run -p 5963:5963 \
  -v $(pwd)/config:/config \
  -v $(pwd)/packages:/packages \
  nuget-server:latest
```

### Custom configuration

```bash
# Custom port (using Docker port forwarding)
docker run -p 3000:5963 -v $(pwd)/packages:/packages nuget-server:latest

# With base URL for reverse proxy
docker run -p 5963:5963 -v $(pwd)/packages:/packages \
  nuget-server:latest --base-url https://nuget.example.com

# Multiple options
docker run -p 3000:5963 -v $(pwd)/packages:/packages \
  nuget-server:latest \
  --base-url https://nuget.example.com \
  --trusted-proxies "10.0.0.1,192.168.1.100"
```

### Using environment variables

```bash
docker run -p 5963:5963 \
  -v $(pwd)/packages:/packages \
  -e NUGET_SERVER_BASE_URL=https://nuget.example.com \
  -e NUGET_SERVER_TRUSTED_PROXIES=10.0.0.1 \
  nuget-server:latest
```

### Volume mounts

- `/packages`: Package storage directory (should be mounted to persist data)
- `/config`: Configuration directory for htpasswd files (optional)

The Docker image uses fixed directories internally, but you can mount any host directories to these locations.

---

## Building the Docker image

### Multi-platform build with Podman (recommended)

Use the provided multi-platform build script that uses Podman to build for all supported architectures:

```bash
# Build for all platforms (local only, no push)
./build-docker-multiplatform.sh

# Build and push to Docker Hub
./build-docker-multiplatform.sh --push

# Build for specific platforms only
./build-docker-multiplatform.sh --platforms linux/amd64,linux/arm64

# Push with custom Docker Hub username
OCI_SERVER_USER=yourusername ./build-docker-multiplatform.sh --push

# Inspect existing manifest
./build-docker-multiplatform.sh --inspect
```

**Important**: For cross-platform builds, QEMU emulation must be configured first:

```bash
# Option 1: Use QEMU container (recommended)
sudo podman run --rm --privileged docker.io/multiarch/qemu-user-static --reset -p yes

# Option 2: Install system packages
# Ubuntu/Debian:
sudo apt-get update && sudo apt-get install -y qemu-user-static
# Fedora/RHEL:
sudo dnf install -y qemu-user-static

# Verify QEMU is working:
podman run --rm --platform linux/arm64 alpine:latest uname -m
# Should output: aarch64
```

Without QEMU, you can only build for your native architecture.

---

## License

Under MIT.
