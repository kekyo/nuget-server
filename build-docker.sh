#!/bin/bash

# Build script for nuget-server Docker image

set -e

# Configuration
OCI_SERVER="docker.io"
IMAGE_NAME="nuget-server"
OCI_SERVER_USER=${OCI_SERVER_USER:-"kekyo"}

# Get version from screw-up dump
echo "Getting version information..."
DUMP_OUTPUT=$(npx screw-up dump)
VERSION=$(echo "$DUMP_OUTPUT" | jq -r '.version')
if [ "$VERSION" = "null" ] || [ -z "$VERSION" ]; then
  echo "Warning: Could not extract version, falling back to 'latest'"
  VERSION="latest"
else
  echo "Detected version: $VERSION"
fi

# Full image names
LOCAL_IMAGE="${IMAGE_NAME}:${VERSION}"
LOCAL_LATEST="${IMAGE_NAME}:latest"
REMOTE_IMAGE="${OCI_SERVER}/${OCI_SERVER_USER}/${IMAGE_NAME}:${VERSION}"
REMOTE_LATEST="${OCI_SERVER}/${OCI_SERVER_USER}/${IMAGE_NAME}:latest"

echo "Building Docker image for nuget-server..."
echo "Local image: ${LOCAL_IMAGE}"
echo "Local latest: ${LOCAL_LATEST}"
echo "Remote image: ${REMOTE_IMAGE}"
echo "Remote latest: ${REMOTE_LATEST}"

# Pre-build the application on host
echo "Pre-building application..."
npm run build

# Build the Docker image on podman
echo "Building image..."
podman build -t "${LOCAL_IMAGE}" .

# Tag for Docker Hub
echo "Tagging for Docker Hub..."
podman tag "${LOCAL_IMAGE}" "${LOCAL_LATEST}"
podman tag "${LOCAL_IMAGE}" "${REMOTE_IMAGE}"
podman tag "${LOCAL_IMAGE}" "${REMOTE_LATEST}"

echo "Build completed successfully!"
echo ""
echo "To run locally:"
echo "  docker run -p 5963:5963 -v \$(pwd)/packages:/packages ${LOCAL_IMAGE}"
echo ""
echo "To push to Docker Hub:"
echo "  docker login"
echo "  docker push ${REMOTE_IMAGE}"
echo "  docker push ${REMOTE_LATEST}"
echo ""
echo "Example usage with custom options:"
echo "  docker run -p 3000:5963 -v \$(pwd)/packages:/packages ${LOCAL_IMAGE} --base-url http://localhost:3000"
