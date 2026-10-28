import { defineConfig } from 'vitest/config';
export default defineConfig({
  define: { __BUILD_ID__: '"test"' },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'], environment: 'node' },
});
