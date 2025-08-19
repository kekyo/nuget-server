import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import dts from 'vite-plugin-dts';
import screwUp from 'screw-up';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true
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
      external: ['express', 'commander', 'fs/promises', 'fs', 'os', 'crypto', 'zlib', 'path', 'url', 'xml2js', 'events', 'stream', 'buffer', 'timers', 'util']
    },
    sourcemap: true,
    minify: false
  }
});
