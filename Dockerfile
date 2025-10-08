# Single stage build for nuget-server (pre-built on host)
FROM node:20-alpine AS runtime

# Create app directory
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nugetserver -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force && \
    rm -rf /tmp/*

# Copy pre-built application from host
COPY dist ./dist

# Create packages and data directories and set permissions
RUN mkdir -p /packages /data && \
    chown -R nugetserver:nodejs /app && \
    chown -R nugetserver:nodejs /packages && \
    chown -R nugetserver:nodejs /data

# Switch to non-root user
USER nugetserver

# Expose port
EXPOSE 5963

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5963/api || exit 1

# Default volumes (can be mounted)
VOLUME ["/packages", "/data"]

# Default command with explicit arguments - can be overridden for custom options
CMD ["node", "dist/cli.mjs", "--config-file", "/data/config.json", "--package-dir", "/packages"]
