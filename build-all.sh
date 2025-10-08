#!/bin/sh

set -eu

#------------------------------------------------------

git clean -xfd
npm install

VERSION=`npx screw-up dump | jq -r '.version'`

echo "Build totally deployments: $VERSION"

#------------------------------------------------------

npm run test
npm run pack

#------------------------------------------------------

./build-docker-multiplatform.sh --skip-app-build

#------------------------------------------------------

#npm publish ./artifacts/nuget-server-$VERSION.tgz
#podman manifest push nuget-server:$VERSION docker://docker.io/kekyo/nuget-server:$VERSION
#podman manifest push nuget-server:latest docker://docker.io/kekyo/nuget-server:latest
