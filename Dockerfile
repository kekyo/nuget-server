# Stage 1: Build dependencies (including sodium-native) on Alpine
FROM node:20-alpine AS builder

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nugetserver -u 1001 -G nodejs

COPY package*.json ./

# Install toolchain and libsodium headers for sodium-native source build
RUN apk add --no-cache \
      build-base \
      python3 \
      cmake \
      pkgconf \
      git \
      libsodium-dev

# Install dependencies and compile sodium-native for musl targets
RUN npm ci --only=production && \
    set -eux; \
    ARCH="$(node -p 'process.arch')"; \
    SODIUM_CMAKE_FILES="$(find node_modules -type f -path '*/sodium-native/CMakeLists.txt')"; \
    [ -n "$SODIUM_CMAKE_FILES" ]; \
    for sodium_cmake in $SODIUM_CMAKE_FILES; do \
      sodium_dir="$(dirname "$sodium_cmake")"; \
      npm install --prefix "$sodium_dir" --no-save \
        cmake-bare@1.1.10 \
        cmake-fetch@1.4.7 \
        cmake-napi@1.2.1; \
      cmake -S "$sodium_dir" -B "$sodium_dir/build" -DCMAKE_BUILD_TYPE=Release; \
      cmake --build "$sodium_dir/build"; \
      MUSL_PLATFORM_DIR="$sodium_dir/prebuilds/linux-${ARCH}-musl"; \
      GNU_PLATFORM_DIR="$sodium_dir/prebuilds/linux-${ARCH}"; \
      mkdir -p "$MUSL_PLATFORM_DIR" "$GNU_PLATFORM_DIR"; \
      install -m 0644 "$sodium_dir/build/sodium-native.node" "$MUSL_PLATFORM_DIR/sodium-native.node"; \
      install -m 0644 "$sodium_dir/build/sodium-native.bare" "$MUSL_PLATFORM_DIR/sodium-native.bare"; \
      install -m 0644 "$sodium_dir/build/sodium-native.node" "$GNU_PLATFORM_DIR/sodium-native.node"; \
      install -m 0644 "$sodium_dir/build/sodium-native.bare" "$GNU_PLATFORM_DIR/sodium-native.bare"; \
      rm -rf "$sodium_dir/build" "$sodium_dir/sodium-native.node" "$sodium_dir/sodium-native.bare" "$sodium_dir/node_modules"; \
    done && \
    npm cache clean --force && \
    rm -rf /tmp/*

COPY dist ./dist

# Stage 2: Runtime image with only required runtime packages
FROM node:20-alpine AS runtime

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nugetserver -u 1001 -G nodejs

# Runtime needs shared libs but not headers/toolchain
RUN apk add --no-cache libsodium

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p /packages /data && \
    chown -R nugetserver:nodejs /app && \
    chown -R nugetserver:nodejs /packages && \
    chown -R nugetserver:nodejs /data

USER nugetserver

EXPOSE 5963

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5963/api || exit 1

VOLUME ["/packages", "/data"]

CMD ["node", "dist/cli.mjs", "--config-file", "/data/config.json", "--package-dir", "/packages"]
