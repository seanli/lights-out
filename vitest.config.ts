import { defineConfig } from 'vitest/config';
export default defineConfig({
  cacheDir: '.cache/vite',
  define: { __BUILD_ID__: '"test"' },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'], environment: 'node' },
});
