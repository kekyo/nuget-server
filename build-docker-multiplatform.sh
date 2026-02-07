#!/bin/bash

# Multi-platform Podman build script for nuget-server
# Supports: linux/amd64, linux/arm64, linux/arm/v7

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration (same as build-docker.sh)
OCI_SERVER="docker.io"
IMAGE_NAME="nuget-server"
OCI_SERVER_USER=${OCI_SERVER_USER:-"kekyo"}
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH_TO_REGISTRY="${PUSH_TO_REGISTRY:-false}"
VERIFY_TARGET_PLATFORMS="${VERIFY_TARGET_PLATFORMS:-true}"
VERIFY_HOST_IMAGE="${VERIFY_HOST_IMAGE:-true}"

# Functions
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

get_version() {
    print_info "Getting version information..."
    DUMP_OUTPUT=$(npx screw-up dump)
    VERSION=$(echo "$DUMP_OUTPUT" | jq -r '.version')
    if [ "$VERSION" = "null" ] || [ -z "$VERSION" ]; then
        print_warning "Could not extract version, falling back to 'latest'"
        VERSION="latest"
    else
        print_info "Detected version: $VERSION"
    fi
}

check_dependencies() {
    print_info "Checking dependencies..."

    if ! command -v podman &> /dev/null; then
        print_error "Podman is not installed"
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        print_error "jq is not installed (required for version extraction)"
        exit 1
    fi

    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed (required for smoke tests)"
        exit 1
    fi

    # Check for QEMU support for cross-platform builds
    if ! podman run --rm --platform linux/arm64 alpine:latest true &> /dev/null; then
        print_warning "QEMU emulation is not properly configured for cross-platform builds"
        print_error "Cannot build for non-native architectures without QEMU"
        print_info ""
        print_info "To enable multi-arch support, please run ONE of the following:"
        print_info ""
        print_info "Option 1: Use QEMU container (recommended):"
        print_info "  sudo podman run --rm --privileged docker.io/multiarch/qemu-user-static --reset -p yes"
        print_info ""
        print_info "Option 2: Install system packages:"
        print_info "  # For Ubuntu/Debian:"
        print_info "  sudo apt-get update && sudo apt-get install -y qemu-user-static"
        print_info "  # For Fedora/RHEL:"
        print_info "  sudo dnf install -y qemu-user-static"
        print_info ""
        print_info "After setup, verify with:"
        print_info "  podman run --rm --platform linux/arm64 alpine:latest uname -m"
        print_info ""

        # Check if we're trying to build for non-native platforms
        NATIVE_ARCH=$(uname -m)
        case "$NATIVE_ARCH" in
            x86_64) NATIVE_PLATFORM="linux/amd64" ;;
            aarch64) NATIVE_PLATFORM="linux/arm64" ;;
            armv7l) NATIVE_PLATFORM="linux/arm/v7" ;;
            *) NATIVE_PLATFORM="linux/$NATIVE_ARCH" ;;
        esac

        if [ "$PLATFORMS" != "$NATIVE_PLATFORM" ]; then
            print_error "Attempting to build for platforms: $PLATFORMS"
            print_error "But QEMU is not configured. Only native platform ($NATIVE_PLATFORM) is available."
            print_info ""
            print_info "You can either:"
            print_info "  1. Configure QEMU as shown above"
            print_info "  2. Build only for native platform: $0 --platforms $NATIVE_PLATFORM"
            exit 1
        fi
    fi

    print_info "All dependencies are satisfied"
}

get_host_platform() {
    local native_arch
    native_arch=$(uname -m)
    case "$native_arch" in
        x86_64) echo "linux/amd64" ;;
        aarch64) echo "linux/arm64" ;;
        armv7l) echo "linux/arm/v7" ;;
        *) echo "linux/$native_arch" ;;
    esac
}

fail_smoke_check() {
    local container_name="$1"
    local reason="$2"

    print_error "$reason"
    print_info "Container logs ($container_name):"
    podman logs "$container_name" || true
    podman rm -f "$container_name" >/dev/null 2>&1 || true
    exit 1
}

run_binary_load_check() {
    local platform="$1"
    local image="$2"

    print_info "Binary load check on ${platform}..."
    if ! podman run --rm --platform "$platform" --entrypoint node "$image" \
        -e "require('@fastify/secure-session'); console.log('binary-load-ok');"; then
        print_error "Binary load check failed on ${platform}"
        exit 1
    fi
}

run_http_smoke_check() {
    local platform="$1"
    local image="$2"
    local label="$3"

    local container_name
    local status
    local port_line
    local host_port
    local ready=false
    local run_platform_args=()

    if [ -n "$platform" ]; then
        run_platform_args=(--platform "$platform")
    fi

    container_name="nuget-server-smoke-${label}-$(date +%s)-${RANDOM}"

    print_info "HTTP smoke check (${label})..."
    if ! podman run -d --name "$container_name" -p 127.0.0.1::5963 \
        "${run_platform_args[@]}" "$image" >/dev/null; then
        print_error "Failed to start container for smoke check (${label})"
        exit 1
    fi

    port_line=$(podman port "$container_name" 5963/tcp | head -n 1 || true)
    host_port="${port_line##*:}"

    if ! [[ "$host_port" =~ ^[0-9]+$ ]]; then
        fail_smoke_check "$container_name" "Failed to detect mapped host port for ${label}"
    fi

    for _ in $(seq 1 90); do
        status=$(podman inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null || echo "unknown")
        if [ "$status" != "running" ]; then
            fail_smoke_check "$container_name" "Container exited before ready (${label})"
        fi

        if curl -fsS --max-time 2 "http://127.0.0.1:${host_port}/health" >/dev/null 2>&1; then
            ready=true
            break
        fi
        sleep 1
    done

    if [ "$ready" != "true" ]; then
        fail_smoke_check "$container_name" "Timed out waiting for server startup (${label})"
    fi

    if ! curl -fsS --max-time 5 "http://127.0.0.1:${host_port}/health" \
        | jq -e '.status == "ok"' >/dev/null; then
        fail_smoke_check "$container_name" "Health endpoint check failed (${label})"
    fi

    if ! curl -fsS --max-time 5 "http://127.0.0.1:${host_port}/v3/index.json" \
        | jq -e '.version and (.resources | type == "array") and (.resources | length > 0)' >/dev/null; then
        fail_smoke_check "$container_name" "NuGet V3 endpoint check failed (${label})"
    fi

    if ! curl -fsS --max-time 5 -H 'Accept: text/html' "http://127.0.0.1:${host_port}/" \
        | grep -qi '<!doctype html>'; then
        fail_smoke_check "$container_name" "UI endpoint check failed (${label})"
    fi

    podman rm -f "$container_name" >/dev/null 2>&1 || true
}

verify_target_platforms() {
    print_info "Verifying all target platforms..."
    while IFS= read -r platform; do
        [ -z "$platform" ] && continue
        run_binary_load_check "$platform" "$LOCAL_IMAGE"
        run_http_smoke_check "$platform" "$LOCAL_IMAGE" "target-${platform//\//-}"
    done < <(echo "$PLATFORMS" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d')
    print_info "All target platform checks passed"
}

verify_host_image() {
    local host_platform
    host_platform=$(get_host_platform)

    print_info "Verifying host image behavior on ${host_platform}..."
    run_http_smoke_check "" "$LOCAL_IMAGE" "host-default"
    print_info "Host image check passed"
}

build_application() {
    print_info "Building application..."

    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Are you in the project root?"
        exit 1
    fi

    npm run build

    if [ ! -d "dist" ]; then
        print_error "Build failed: dist directory not found"
        exit 1
    fi

    print_info "Application built successfully"
}

build_multiplatform_images() {
    # Image names (following build-docker.sh convention)
    LOCAL_IMAGE="${IMAGE_NAME}:${VERSION}"
    LOCAL_LATEST="${IMAGE_NAME}:latest"
    REMOTE_IMAGE="${OCI_SERVER}/${OCI_SERVER_USER}/${IMAGE_NAME}:${VERSION}"
    REMOTE_LATEST="${OCI_SERVER}/${OCI_SERVER_USER}/${IMAGE_NAME}:latest"

    print_info "Building multi-platform images..."
    print_info "Platforms: $PLATFORMS"
    print_info "Local image: ${LOCAL_IMAGE}"
    print_info "Remote image: ${REMOTE_IMAGE}"

    # Create manifest for versioned tag
    MANIFEST_NAME="${LOCAL_IMAGE}"
    print_info "Creating manifest: ${MANIFEST_NAME}"
    podman manifest create "${MANIFEST_NAME}" 2>/dev/null || {
        print_warning "Manifest already exists, removing..."
        podman manifest rm "${MANIFEST_NAME}" 2>/dev/null || true
        podman manifest create "${MANIFEST_NAME}"
    }

    # Build for all platforms and add to manifest
    print_info "Building for platforms: ${PLATFORMS}"
    podman build \
        --platform "${PLATFORMS}" \
        --manifest "${MANIFEST_NAME}" \
        .

    # Create latest tag by copying the versioned manifest
    print_info "Creating latest tag: ${LOCAL_LATEST}"
    # Remove existing latest manifest if it exists
    podman manifest rm "${LOCAL_LATEST}" 2>/dev/null || true
    # Tag the versioned manifest as latest
    podman tag "${MANIFEST_NAME}" "${LOCAL_LATEST}"

    print_info "Build completed successfully!"
}

tag_remote_images() {
    print_info "Tagging images for remote registry..."

    # Tag manifests for remote registry
    # Note: With podman manifest, we'll push directly with the remote names
    print_info "Images are ready for push to:"
    print_info "  ${REMOTE_IMAGE}"
    print_info "  ${REMOTE_LATEST}"
}

push_to_registry() {
    if [ "$PUSH_TO_REGISTRY" = "true" ]; then
        print_info "Pushing manifests to registry..."

        # Push versioned manifest
        print_info "Pushing ${REMOTE_IMAGE}..."
        podman manifest push \
            "${LOCAL_IMAGE}" \
            "docker://${REMOTE_IMAGE}"

        # Push latest manifest
        print_info "Pushing ${REMOTE_LATEST}..."
        podman manifest push \
            "${LOCAL_LATEST}" \
            "docker://${REMOTE_LATEST}"

        print_info "✓ Push completed successfully!"
    else
        print_warning "Not pushing to registry (set PUSH_TO_REGISTRY=true or use --push to enable)"
        print_info ""
        print_info "To push the images manually, run:"
        print_info "  podman manifest push ${LOCAL_IMAGE} docker://${REMOTE_IMAGE}"
        print_info "  podman manifest push ${LOCAL_LATEST} docker://${REMOTE_LATEST}"
    fi
}

inspect_manifest() {
    print_info ""
    print_info "Manifest inspection:"
    print_info "Available platforms in the manifest:"
    podman manifest inspect "${LOCAL_IMAGE}" | jq -r '.manifests[].platform | "\(.os)/\(.architecture)\(if .variant then "/\(.variant)" else "" end)"'
}

show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Build multi-platform container images for nuget-server using Podman

Options:
    -h, --help              Show this help message
    -p, --push              Push images to registry after build
    --platforms PLATFORMS   Comma-separated list of platforms (default: linux/amd64,linux/arm64)
    --skip-app-build        Skip npm build step
    --skip-target-verify    Skip target platform binary/smoke checks
    --skip-host-smoke       Skip host-architecture smoke check
    --skip-verify           Skip all post-build verification checks
    --inspect               Only inspect existing manifest

Environment Variables:
    OCI_SERVER_USER         Registry username (default: kekyo)
    PLATFORMS               Target platforms
    PUSH_TO_REGISTRY        Set to 'true' to push images
    SKIP_APP_BUILD          Set to 'true' to skip npm build
    VERIFY_TARGET_PLATFORMS Set to 'false' to skip target verification
    VERIFY_HOST_IMAGE       Set to 'false' to skip host smoke check

Examples:
    # Build for all platforms without pushing
    $0

    # Build and push to Docker Hub
    $0 --push

    # Build for specific platforms
    $0 --platforms linux/amd64,linux/arm64

    # Build and skip all verification checks
    $0 --skip-verify

    # Push with custom user
    OCI_SERVER_USER=myuser $0 --push

    # Inspect existing manifest
    $0 --inspect

EOF
}

# Parse command line arguments
SKIP_APP_BUILD="${SKIP_APP_BUILD:-false}"
INSPECT_ONLY="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -p|--push)
            PUSH_TO_REGISTRY="true"
            shift
            ;;
        --platforms)
            PLATFORMS="$2"
            shift 2
            ;;
        --skip-app-build)
            SKIP_APP_BUILD="true"
            shift
            ;;
        --skip-target-verify)
            VERIFY_TARGET_PLATFORMS="false"
            shift
            ;;
        --skip-host-smoke)
            VERIFY_HOST_IMAGE="false"
            shift
            ;;
        --skip-verify)
            VERIFY_TARGET_PLATFORMS="false"
            VERIFY_HOST_IMAGE="false"
            shift
            ;;
        --inspect)
            INSPECT_ONLY="true"
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main execution
main() {
    print_info "Starting multi-platform Podman build process"
    print_info "Registry: ${OCI_SERVER}/${OCI_SERVER_USER}"
    print_info "Platforms: $PLATFORMS"

    # Get version information
    get_version

    if [ "$INSPECT_ONLY" = "true" ]; then
        inspect_manifest
        exit 0
    fi

    check_dependencies

    if [ "$SKIP_APP_BUILD" != "true" ]; then
        build_application
    else
        print_warning "Skipping application build (SKIP_APP_BUILD=true)"
    fi

    build_multiplatform_images

    if [ "$VERIFY_TARGET_PLATFORMS" = "true" ]; then
        verify_target_platforms
    else
        print_warning "Skipping target platform verification (VERIFY_TARGET_PLATFORMS=false)"
    fi

    if [ "$VERIFY_HOST_IMAGE" = "true" ]; then
        verify_host_image
    else
        print_warning "Skipping host image smoke check (VERIFY_HOST_IMAGE=false)"
    fi

    tag_remote_images
    push_to_registry
    inspect_manifest

    print_info ""
    print_info "✓ Multi-platform build completed successfully!"

    if [ "$PUSH_TO_REGISTRY" != "true" ]; then
        print_info ""
        print_info "To test the multi-arch image locally:"
        print_info "  podman run --platform linux/amd64 -p 5963:5963 ${LOCAL_IMAGE}"
        print_info "  podman run --platform linux/arm64 -p 5963:5963 ${LOCAL_IMAGE}"
    fi
}

# Run main function
main
