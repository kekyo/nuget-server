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

# Install dependencies, compile sodium-native against musl, and clean up build artefacts
RUN npm ci --only=production && \
    npm install --prefix node_modules/sodium-native --no-save \
      cmake-bare@1.1.10 \
      cmake-fetch@1.4.7 \
      cmake-napi@1.2.1 && \
    cd node_modules/sodium-native && \
    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build && \
    ARCH="$(node -p 'process.arch')" && \
    PLATFORM_DIR="prebuilds/linux-${ARCH}" && \
    install -m 0644 build/sodium-native.node "${PLATFORM_DIR}/sodium-native.node" && \
    install -m 0644 build/sodium-native.bare "${PLATFORM_DIR}/sodium-native.bare" && \
    rm -rf build sodium-native.node sodium-native.bare node_modules && \
    cd /app && \
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
