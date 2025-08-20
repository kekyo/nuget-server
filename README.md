# nuget-server

Lightweight NuGet server implementation on Node.js

![nuget-server](images/nuget-server-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/nuget-server.svg)](https://www.npmjs.com/package/nuget-server)

----

## What is this?

A simple NuGet server implementation built on Node.js that provides essential NuGet v3 API endpoints.

Compatible with `dotnet restore` and standard NuGet clients for package publishing, querying, and downloading.

### Key Features

* Easy setup, run NuGet server in 10 seconds!
* NuGet V3 API compatibility: Support for modern NuGet client operations
* No need database management: Store package file and nuspecs into filesystem directly, feel free any database managements
* Package publish: Flexible client to upload `.nupkg` files via `HTTP POST` using cURL and others
* Basic authentication: htpasswd-based authentication for publish and general access
* Proxy support: Configurable trusted proxy handling for proper URL resolution
* Docker image available

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
```

The NuGet V3 API is served on the `/api` path.

* Default nuget-server served URL: `http://localhost:5963`
* Actual NuGet V3 API endpoint: `http://localhost:5963/api/index.json`

Default nuget-server served URL can change with `--base-url` option, it shows below section.

## Configure the NuGet client

### Add nuget-server as package source

Add as package source:

```bash
dotnet nuget add source http://localhost:5963/api/index.json \
  -n "local" --allow-insecure-connections
```

Or specify in `nuget.config`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="local" value="http://localhost:5963/api/index.json"
      allowInsecureConnections="true" />
  </packageSources>
</configuration>
```

### Publish packages

Upload packages by `HTTP POST` method, using cURL or any HTTP client with `/api/publish` endpoint:

```bash
# Upload a .nupkg file
curl -X POST http://localhost:5963/api/publish \
  --data-binary @MyPackage.1.0.0.nupkg \
  -H "Content-Type: application/octet-stream"
```

This methodology uses simply HTTP POST with binary (octet-stream) instead of the standard NuGet V3 publish protocol,
because it is gateway,reverse-proxy,load-balancer friendy access.

## Package storage configuration

### Storage location

By default, packages are stored in the `./packages` directory relative to where you run nuget-server.
You can customize this location using the `--package-dir` option:

```bash
# Use default ./packages directory
nuget-server

# Use custom directory (relative or absolute path)
nuget-server --package-dir ./package-storage
```

### Package storage layout

Packages are stored in the filesystem using the following structure:

```
[package-dir]/
├── PackageName/
│   ├── 1.0.0/
│   │   ├── PackageName.1.0.0.nupkg
│   │   └── PackageName.nuspec
│   └── 2.0.0/
│       ├── PackageName.2.0.0.nupkg
│       └── PackageName.nuspec
└── AnotherPackage/
    └── 1.5.0/
        ├── AnotherPackage.1.5.0.nupkg
        └── AnotherPackage.nuspec
```

### Backup and Restore

You can backup the package directory using simply `tar`:

```bash
cd /your/server/base/dir
tar -cf - ./packages | lz4 -9 > backup-packages.tar.lz4
```

Restore is simply extract it and re-run nuget-server with the same package directory configuration.

----

## Configuration directory

You can specify a custom configuration directory:

```bash
# Using command line option
nuget-server --config-dir /path/to/config

# Using environment variable
export NUGET_SERVER_CONFIG_DIR=/path/to/config
nuget-server
```

The configuration directory is used for the following basic authentication.

## Basic authentication

The nuget-server supports Basic authentication using `htpasswd` files for securing package access and publishing.

### Authentication configuration

Authentication files are loaded from the configuration directory (default: current directory):

- `htpasswd-publish`: Controls access to package publishing (`/api/publish`)
- `htpasswd`: Controls access to package downloads and queries

If authentication files don't exist, the corresponding operations are allowed without authentication.

### Creating htpasswd Files

Use the `htpasswd` utility (from Apache HTTP Server):

```bash
sudo apt install apache2-utils
```

To create user credential files:

```bash
# Create htpasswd file for publish authentication
htpasswd -c htpasswd-publish publisher

# Add more users to existing file
htpasswd htpasswd-publish another-publisher

# Create htpasswd file for general access
htpasswd -c htpasswd reader
```

### Authentication access examples

Add package source with credentials:

```bash
dotnet nuget add source http://localhost:5963/api/index.json \
  -n "local" \
  -u "reader" \
  -p "your-password" \
  --store-password-in-clear-text \
  --allow-insecure-connections
```

Or specify `nuget.config` with credentials:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="local" value="http://localhost:5963/api/index.json"
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

For publising:

```bash
# Publish with authentication
curl -X POST http://localhost:5963/api/publish \
  -u publisher:password \
  --data-binary @MyPackage.1.0.0.nupkg \
  -H "Content-Type: application/octet-stream"
```

### Supported hash formats

- MD5 (APR1): `$apr1$salt$hash` - Default htpasswd format
- SHA1: `{SHA}base64hash` - Generated with `htpasswd -s`
- bcrypt: `$2a$`, `$2b$`, `$2y$` - Generated with `htpasswd -B`
- Plain text: Not recommended for production

## Reverse proxy interoperability

The server supports running behind reverse proxies with proper URL resolution.

The server resolves URLs using the following priority order:

1. Fixed base URL (highest priority): When `--base-url` option is specified, it always takes precedence
2. Trusted proxy headers: When trusted proxies are configured with `--trusted-proxies`:
   - RFC 7239 compliant `Forwarded` header (proto, host, port)
   - Traditional `X-Forwarded-*` headers (`X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`)
3. Standard request information (fallback): Uses `Host` header when proxy headers are not available

For example `--base-url` option:

* nuget-server served public base URL: `https://packages.example.com`
* Actual NuGet V3 API endpoint: `https://packages.example.com/api/index.json`

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
export NUGET_SERVER_CONFIG_DIR=/path/to/config
```

## Supported NuGet V3 API endpoints

The server implements a subset of the NuGet V3 API protocol:

* Service index: `/api/index.json`
* Package content: `/api/package/{id}/index.json`
* Package downloads: `/api/package/{id}/{version}/{filename}`
* Registration index: `/api/registrations/{id}/index.json`

----

## Docker Usage (WIP)

### Building the Docker Image

Use the provided build script (require podman):

```bash
./build-docker.sh
```

Or build manually:

```bash
# Build the image
docker build -t nuget-server:latest .

# Tag for Docker Hub (replace with your username)
docker tag nuget-server:latest yourusername/nuget-server:latest
```

### Running with Docker

#### Basic Usage

```bash
# Run with default settings (port 5963, packages stored in mounted volume)
docker run -p 5963:5963 -v $(pwd)/packages:/packages nuget-server:latest

# With authentication configuration directory
docker run -p 5963:5963 \
  -v $(pwd)/packages:/packages \
  -v $(pwd)/config:/config \
  nuget-server:latest
```

#### Custom Configuration

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

#### Using Environment Variables

```bash
docker run -p 5963:5963 \
  -v $(pwd)/packages:/packages \
  -e NUGET_SERVER_BASE_URL=https://nuget.example.com \
  -e NUGET_SERVER_TRUSTED_PROXIES=10.0.0.1 \
  nuget-server:latest
```

### Volume Mounts

- `/packages`: Package storage directory (should be mounted to persist data)
- `/config`: Configuration directory for htpasswd files (optional)

The Docker image uses fixed directories internally, but you can mount any host directories to these locations.

----

## TODO

* Package explorer UI
* API key authentication (alternative to Basic auth)
* User management commands

## License

Under MIT.
