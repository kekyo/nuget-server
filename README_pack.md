# nuget-server

Simple modenized NuGet server implementation on Node.js

![nuget-server](images/nuget-server-120.png)

[![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is this?

A simple NuGet server implementation built on Node.js that provides essential NuGet v3 API endpoints.

Compatible with `dotnet restore` and standard NuGet clients for package publishing, querying, and downloading.

A modern browser-based UI is also provided:

- You can refer to registered packages. You can check various package attributes.
- You can download packages by version.
- You can also publish (upload) packages.
- You can manage user accounts.

![Browse packages](images/nuget-server-ss-1.png)

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

## System Requirements

Node.js 20.18.0 or later

---

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

---

## Documentation

[See the repository](https://github.com/kekyo/nuget-server)

## License

Under MIT.
