import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import dts from 'vite-plugin-dts';
import screwUp from 'screw-up';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      exclude: ['src/ui/**/*']
    }),
    screwUp({
      outputMetadataFile: true
    })
  ],
  build: {
    lib: {
      entry: {
        index: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/index.ts'),
        cli: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/cli.ts')
      },
      name: 'nuget-server',
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['commander', 'fs/promises', 'fs', 'os', 'crypto', 'zlib', 'path', 'url', 'xml2js', 'events', 'stream', 'buffer', 'timers', 'util', 'adm-zip', 'async-primitives', 'dayjs', 'fastify', '@fastify/passport', '@fastify/secure-session', '@fastify/static', '@fastify/send', 'passport-local', 'passport-http', 'readline', 'glob', 'path-scurry', 'minipass']
    },
    sourcemap: true,
    minify: false
  }
});
