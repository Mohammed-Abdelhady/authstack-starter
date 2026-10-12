import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same "@/*" mapping as tsconfig, so a test can import a module that uses it.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/tests/setup.ts'],
    // next-intl imports "next/navigation" without an extension, which Node
    // cannot resolve on its own. Transforming it lets Vite resolve the path.
    server: { deps: { inline: ['next-intl'] } },
  },
});
