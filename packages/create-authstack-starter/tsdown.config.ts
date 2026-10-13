import { defineConfig } from 'tsdown';

// Everything ships in one ESM file so `pnpm dlx create-authstack-starter` installs no
// dependencies. @clack/prompts and commander are devDependencies for that reason.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22.12',
  noExternal: ['@clack/prompts', 'commander', 'prettier', 'yaml'],
  // platform: 'node' would force .mjs. The package is type: module, so plain
  // .js keeps the bin path in package.json and the README simple.
  fixedExtension: false,
  dts: false,
  clean: true,
  treeshake: true,
});
