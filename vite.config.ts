import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import screwUp from 'screw-up';
import { fastifyHost } from './src/plugins/vite-plugin-fastify';
import { ServerConfig } from './src/types';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode, command }) => {
  const isDev = mode === 'development';
  const isBuild = command === 'build';
  
  // Development server configuration
  const devConfig: ServerConfig = {
    port: 5963,
    packageDir: './dev/packages',
    configDir: './dev',
    realm: 'nuget-server dev',
    noUi: false,
    authMode: 'publish',
    trustedProxies: []
  };
  
  // For development mode, use UI as root
  if (isDev && !isBuild) {
    return {
      root: 'src/ui',
      plugins: [
        react(),
        screwUp({
          outputMetadataFile: true
        }),
        // Add Fastify plugin for development
        fastifyHost(devConfig)
      ],
      server: {
        port: 3000,
        // No proxy needed as Fastify runs in same process
      },
      build: {
        outDir: '../../dist/ui',
        emptyOutDir: true,
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'src/ui/index.html'),
            login: resolve(__dirname, 'src/ui/login.html')
          }
        }
      }
    };
  }
  
  // For build mode, handle both server and UI
  return {
    plugins: [
      react(),
      dts({
        insertTypesEntry: true,
        exclude: ['src/ui/**/*', 'src/plugins/**/*']
      }),
      screwUp({
        outputMetadataFile: true
      })
    ],
    build: {
      // Build server code as library
      lib: {
        entry: {
          index: resolve(__dirname, 'src/index.ts'),
          cli: resolve(__dirname, 'src/cli.ts')
        },
        name: 'nuget-server',
        fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
        formats: ['es', 'cjs']
      },
      rollupOptions: {
        external: [
          'commander', 'fs/promises', 'fs', 'os', 'crypto', 'zlib', 
          'path', 'url', 'xml2js', 'events', 'stream', 'buffer', 
          'timers', 'util', 'adm-zip', 'async-primitives', 'dayjs', 
          'fastify', '@fastify/passport', '@fastify/secure-session', 
          '@fastify/static', '@fastify/send', 'passport-local', 
          'passport-http', 'readline', 'glob', 'path-scurry', 'minipass',
          // React-related externals for server build
          'react', 'react-dom', '@mui/material', '@mui/icons-material',
          '@emotion/react', '@emotion/styled'
        ]
      },
      sourcemap: true,
      minify: false
    }
  };
});