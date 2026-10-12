import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { prune } from '../../src/prune/index.js';
import { createOptionFixtureTree, OPTION_MANIFEST } from '../support/option-fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

it.each([
  { options: [] },
  { options: ['docker'] },
  { options: ['docker', 'production'] },
  { options: ['locale-ar'] },
])('ships lint-staged globs for surviving folders with options %j', async ({ options }) => {
  const root = await createOptionFixtureTree({
    'backend/src/index.ts': 'export const value = 1;\n',
    'shared/core/src/index.ts': 'export const value = 1;\n',
    'shared/sdk/src/index.ts': 'export const value = 1;\n',
  });
  try {
    await writeFile(
      join(root, '.lintstagedrc.cjs'),
      await readFile(join(REPO_ROOT, '.lintstagedrc.cjs')),
    );
    await prune(root, OPTION_MANIFEST, ['email-password'], options);
    const config = createRequire(import.meta.url)(join(root, '.lintstagedrc.cjs')) as Record<
      string,
      string[]
    >;
    expect(Object.keys(config)).toEqual([
      'backend/**/*.{ts,js,json}',
      'backend/**/*.ts',
      'frontend/**/*.{ts,tsx,js,jsx,json}',
      'frontend/**/*.{ts,tsx}',
      'shared/**/*.{ts,tsx,js,json}',
      'shared/core/**/*.ts',
      'shared/sdk/**/*.ts',
      '*.{md,yml,yaml}',
    ]);
    for (const glob of Object.keys(config)) {
      const prefix = glob.slice(0, glob.indexOf('*')).replace(/\/$/, '');
      expect((await stat(join(root, prefix))).isDirectory()).toBe(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
