import { defineConfig } from 'vitest/config';
export default defineConfig({
  cacheDir: '.cache/vite',
  define: { __BUILD_ID__: '"test"', __VERSION__: '"0.0.0-test"' },
  // module discovery uses import.meta.glob; a cached transform would hide added or deleted modules
  test: { fsModuleCache: false, include: ['src/**/*.test.ts', 'test/**/*.test.ts'], environment: 'node' },
});
