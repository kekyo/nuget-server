# nuget-server

Simple modenized NuGet server implementation.

![nuget-server](images/nuget-server-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/nuget-server.svg)](https://www.npmjs.com/package/nuget-server)
[![Docker Image Version](https://img.shields.io/docker/v/kekyo/nuget-server.svg?label=docker)](https://hub.docker.com/r/kekyo/nuget-server)

---

[(日本語はこちら)](./README_ja.md)

## What is this?

A simple NuGet server implementation built on Node.js that provides essential NuGet v3 API endpoints.

Compatible with `dotnet restore` and standard NuGet clients for package publishing, querying, and manually downloading.

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

---

## Installation

```bash
npm install -g nuget-server
```

For using Docker images, refer to a separate chapter.

## Usage

```bash
# Start server on default port 5963
nuget-server

# Custom port
nuget-server --port 3000

# Multiple options
nuget-server --port 3000 --config-file config/config.json --users-file config/users.json
```

The NuGet V3 API is served on the `/v3` path.

- Default nuget-server served URL (Show UI): `http://localhost:5963`
- Actual NuGet V3 API endpoint: `http://localhost:5963/v3/index.json`

The default URL provided by nuget-server can be changed using the `--base-url` option.
This is particularly necessary when public endpoint service using a reverse proxy. For details, refer to below chapter.

## Configure the NuGet client

nuget-server only supports the NuGet V3 API. Therefore, NuGet clients must always access it using the V3 API.

If you do not explicitly specify to use the V3 API, some implementations may fall back to the V3 API while others may not, potentially causing unstable behavior. Therefore, you must always specify it. Example below.

Add as package source:

**For HTTP endpoints:**

```bash
dotnet nuget add source http://localhost:5963/v3/index.json \
  -n "local" --protocol-version 3 --allow-insecure-connections
```

**For HTTPS endpoints:**

```bash
dotnet nuget add source https://packages.example.com/v3/index.json \
  -n "packages" --protocol-version 3
```

Or specify in `nuget.config`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="local" value="http://localhost:5963/v3/index.json"
      protocolVersion="3" allowInsecureConnections="true" />
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

You may be dissatisfied with publishing using this method. The dotnet command includes `dotnet nuget push`, which is the standard approach.
However, in my experience, this protocol uses `multipart/form-data` for transmission, which has caused issues with gateway services, reverse proxies, load balancers, and similar components.
Therefore, the current nuget-server does not implement this method and instead uses the simplest binary transmission procedure.

Another advantage is that when authentication is enabled, you don't need to manage Basic authentication and V3 API keys separately.
You might still feel issue with managing read operations and publish operation with the same key,
but in that case, you can simply separate the users.

For authentication feature, please refer to below chapter.

---

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

Restore is simply extract it and re-run nuget-server with the same package directory configuration, because nuget-server does not use any specialized storage such as databases.

---

## Configuration

nuget-server supports configuration through command-line options, environment variables, and JSON file.

Settings are applied in the following order (highest to lowest priority):

1. Command-line options
2. Environment variables
3. `config.json`
4. Default values

## Configuration file structure

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
Both `packageDir` and `usersFile` paths can be absolute or relative. If relative, they are resolved from the directory containing the `config.json` file.

---

## Authentication

nuget-server also supports authentication.

|Authentication Mode|Details|Auth Initialization|
|:----|:----|:----|
|`none`|Default. No authentication required|Not required|
|`publish`|Authentication required only for package publishing|Required|
|`full`|Authentication required for all operations (must login first)|Required|

To enable authentication on the NuGet server, first register an initial user using the `--auth-init` option.

### Initialize

Create an initial admin user interactively:

```bash
nuget-server --auth-init
```

This command will:

1. Prompt for admin username (default: `admin`)
2. Prompt for password (with strength checking, masked input)
3. Create `users.json`
4. Exit after initialization (server does not start)

When enabling authentication using a Docker image, use this option to generate the initial user.

### Example session

```
Initializing authentication...
Enter admin username [admin]:
Enter password: ********
Confirm password: ********

============================================================
Admin user created successfully!
============================================================
Username: admin
Password: *********************
============================================================
```

### User Management

Users added with `--auth-init` automatically become administrator users.
Administrator users can add or remove other users via the UI. They can also reset user passwords.

![User administration](images/nuget-server-ss-4.png)

While administrator users can also be assigned API passwords (described later), we recommend separating users for management whenever possible.

### Using the API password

The NuGet server distinguishes between the password used to log in to the UI and the password used by NuGet clients when accessing the server.
The password used by NuGet clients when accessing the server is called the "API password,"
and access is granted using the combination of the user and the API password.

Please log in by displaying the UI in the browser.
Select the “API password” menu from the UI menu to generate an API password.
Using this API password will enable access from the NuGet client.

![API password](images/nuget-server-ss-5.png)

Here is an example of using the API password:

```bash
# Add source with API password
dotnet nuget add source http://localhost:5963/v3/index.json \
  -n "local" \
  -u admin \
  -p xxxxxxxxxxxxxxxxxxxxxx \
  --protocol-version 3 --store-password-in-clear-text --allow-insecure-connections
```

Or specify `nuget.config` with credentials:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="local" value="http://localhost:5963/v3/index.json"
      protocolVersion="3" allowInsecureConnections="true" />
  </packageSources>
  <packageSourceCredentials>
    <local>
      <add key="Username" value="reader" />
      <add key="ClearTextPassword" value="xxxxxxxxxxxxxxxxxxxxxx" />
    </local>
  </packageSourceCredentials>
</configuration>
```

For package publishing:

```bash
# Publish packages with API password
curl -X POST http://localhost:5963/api/publish \
  -u admin:xxxxxxxxxxxxxxxxxxxxxx \
  --data-binary @MyPackage.1.0.0.nupkg \
  -H "Content-Type: application/octet-stream"
```

When publishing a package, you can send the package by setting Basic authentication in the `Authorization` header.

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

The NuGet server stores both "password" and "API password" as SALT hashed information, so no plaintext passwords are ever saved.
However, if you do not use HTTPS (TLS), be aware that the `Authorization` header will contain the plaintext password, making it vulnerable to sniffing.
When makes public endpoint, protect communications using HTTPS.

---

## Import packages from another NuGet server

Import all packages from another NuGet server to your local nuget-server instance.
This feature can be used when migrating the foreign NuGet server to nuget-server.

### Package import from another NuGet server

Import packages interactively in CLI:

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

### Import behavior

- Existing packages with the same version will be overwritten
- Failed imports are logged with error details
- Progress is reported at 1% intervals to reduce log noise
- Package icons are preserved during import

Parallel downloads are not done. This is to avoid making a large number of requests to the repository.

This feature is a type of downloader.
Therefore, it does not need to be run on the actual host where it will operate.
You can perform the import process in advance on a separate host and then move the `packages` directory as-is.

### Example session

```
Starting package import...
Enter source NuGet server URL [http://host.example.com/repository/nuget/]: https://nexus.example.com/repository/nuget/
Does the server require authentication? [y/N]: y
Enter username: reader
Enter password: **********

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

---

## Reverse proxy interoperability

The server supports running behind a reverse proxy.
For example, when you have a public URL like `https://nuget.example.com` and run nuget-server on a host within your internal network via a gateway.

In such cases, you MUST specify the base URL of the public URL to ensure the NuGet V3 API can provide the correct sub-endpoint address.

### URL resolving

The server resolves URLs using the following priority order:

1. Fixed base URL (highest priority): When `--base-url` option is specified, it always takes precedence
2. Trusted proxy headers: When trusted proxies are configured with `--trusted-proxies`:
   - HTTP `Forwarded` header (proto, host, port)
   - Traditional `X-Forwarded-*` headers (`X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`)
3. Standard request information (fallback): Uses `Host` header when proxy headers are not available

For example `--base-url` option:

- nuget-server served public base URL: `https://packages.example.com`
- Actual NuGet V3 API endpoint: `https://packages.example.com/v3/index.json`

```bash
# Configure served base URL (do not include /v3 path)
nuget-server --base-url https://packages.example.com

# Add as NuGet source (HTTPS - no --allow-insecure-connections needed)
dotnet nuget add source https://packages.example.com/v3/index.json \
  -n "packages" --protocol-version 3
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

---

## Docker usage

Docker images are available for multiple architectures:

- `linux/amd64` (x86_64)
- `linux/arm64` (aarch64)

When pulling the image, Docker automatically selects the appropriate architecture for your platform.

### Quick start

Suppose you have configured the following directory structure for persistence (recommended):

```
docker-instance/
├── data/
│   ├── config.json
│   └── user.json
└── packages/
    └── (package files)
```

Execute as follows:

```bash
# Pull and run the latest version
docker run -d -p 5963:5963 \
  -v $(pwd)/data:/data \
  -v $(pwd)/packages:/packages \
  kekyo/nuget-server:latest

# Or with Docker Compose
cat > docker-compose.yml << EOF
version: '3'
services:
  nuget-server:
    image: kekyo/nuget-server:latest
    ports:
      - "5963:5963"
    volumes:
      - ./data:/data
      - ./packages:/packages
    environment:
      - NUGET_SERVER_AUTH_MODE=publish
EOF

docker-compose up -d
```

Your NuGet server is now available at:

- Web UI: `http://localhost:5963`
- NuGet V3 API: `http://localhost:5963/v3/index.json`

### Permission requirements

The Docker container runs as the `nugetserver` user (UID 1001) for security reasons. You need to ensure that the mounted directories have the appropriate permissions for this user to write files.

**Set proper permissions for mounted directories:**

```bash
# Create directories if they don't exist
mkdir -p ./data ./packages

# Set ownership to UID 1001 (matches the container's nugetserver user)
sudo chown -R 1001:1001 ./data ./packages
```

**Important**: Without proper permissions, you may encounter `500 Permission Denied` errors when:
- Creating or updating user accounts
- Publishing packages
- Writing configuration files

### Basic usage

```bash
# Run with default settings (port 5963, packages and data stored in mounted volumes)
docker run -p 5963:5963 \
  -v $(pwd)/data:/data \
  -v $(pwd)/packages:/packages \
  kekyo/nuget-server:latest

# With authentication (users.json will be created in /data)
docker run -p 5963:5963 \
  -v $(pwd)/data:/data \
  -v $(pwd)/packages:/packages \
  -e NUGET_SERVER_AUTH_MODE=publish \
  kekyo/nuget-server:latest
```

You can also change settings using environment variables or command-line options, but the easiest way to configure settings is to use `config.json`.

Since the Docker image has mount points configured, you can mount `/data` and `/packages` as shown in the example above and place `/data/config.json` there to flexibly configure settings. Below is an example of `config.json`:

```json
{
  "port": 5963,
  "baseUrl": "http://localhost:5963",
  "realm": "Awsome nuget-server",
  "logLevel": "info",
  "authMode": "publish"
}
```

When initializing credentials or importing packages, configure `config.json` and perform the operation via the CLI before launching the Docker image:

```bash
# Initialize authentication
nuget-server -c ./data/config.json --auth-init
```

### Volume mounts and configuration

- `/data`: Default data directory for `config.json`, `users.json` and other persistent data
- `/packages`: Default package storage directory (mounted to persist packages)

**Default behavior**: The Docker image runs with `--users-file /data/users.json --package-dir /packages` by default.

**Configuration priority** (highest to lowest):

1. Custom command line arguments (when overriding CMD)
2. Environment variables (e.g., `NUGET_SERVER_PACKAGE_DIR`)
3. `config.json` file (if explicitly specified)
4. Default command line arguments in Dockerfile

### Example of Automatic Startup Using systemd

Various methods exist for automatically starting containers with systemd.
Below is a simple example of configuring a systemd service using Podman.
This is a simple service unit file used before quadlets were introduced to Podman.
By placing this file and having systemd recognize it, you can automatically start the nuget-server:

`/etc/systemd/system/container-nuget-server.service`:

```ini
# container-nuget-server.service

[Unit]
Description=Podman container-nuget-server.service
Documentation=man:podman-generate-systemd(1)
Wants=network-online.target
After=network-online.target
RequiresMountsFor=%t/containers

[Service]
Environment=PODMAN_SYSTEMD_UNIT=%n
Restart=always
RestartSec=30
TimeoutStopSec=70
ExecStart=/usr/bin/podman run \
        --cidfile=%t/%n.ctr-id \
        --cgroups=no-conmon \
        --rm \
        --sdnotify=conmon \
        --replace \
        -d \
        -p 5963:5963 \
        --name nuget_server \
        -v /export/data:/data -v /export/packages:/packages docker.io/kekyo/nuget-server:latest
ExecStop=/usr/bin/podman stop \
        --ignore -t 10 \
        --cidfile=%t/%n.ctr-id
ExecStopPost=/usr/bin/podman rm \
        -f \
        --ignore -t 10 \
        --cidfile=%t/%n.ctr-id
Type=notify
NotifyAccess=all

[Install]
WantedBy=default.target
```

---

## Building the Docker image (Advanced)

The build of the nuget-server Docker image uses Podman.

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

## Note

### Non-interactive mode (CI/CD)

The `--auth-init` and `--import-packages` options require interactive responses from the operator.
Therefore, attempting to automate these may not work properly.
In such cases, you can provide credentials via environment variables:

```bash
export NUGET_SERVER_ADMIN_USERNAME=admin
export NUGET_SERVER_ADMIN_PASSWORD=MySecurePassword123!
nuget-server --auth-init --config-file ./config.json
```

This allows initialization in CI/CD pipelines without user interaction.

### Session Security

For special configurations (or to support persistent sessions), you can set a fixed session secret. Specify a sufficiently long value for the secret:

```bash
export NUGET_SERVER_SESSION_SECRET=$(openssl rand -base64 32)
nuget-server
```

(Or use `config.json`.)

If not set, a random secret is generated (warning will be logged).

### Supported NuGet V3 API endpoints

The server implements a subset of the NuGet V3 API protocol:

- Service index: `/v3/index.json`
- Package content: `/v3/package/{id}/index.json`
- Package downloads: `/v3/package/{id}/{version}/{filename}`
- Registration index: `/v3/registrations/{id}/index.json`

---

## License

Under MIT.
