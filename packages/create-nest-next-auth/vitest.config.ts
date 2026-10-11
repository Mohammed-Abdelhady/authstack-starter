import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The combination suite builds and typechecks generated projects, which
    // takes minutes. The `test:combinations*` scripts run it.
    exclude: ['node_modules/**', 'test/**/*.slow.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
