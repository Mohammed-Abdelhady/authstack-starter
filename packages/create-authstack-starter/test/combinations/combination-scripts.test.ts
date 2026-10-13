import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles } from '../../src/utils/fs.js';
import { PACKAGE_DIR } from '../support/combination-helpers.js';

const RUN = 'vitest run --config vitest.combinations.config.ts';
const DATABASE_FILES = [
  'test/combinations/databases-mongodb.slow.test.ts',
  'test/combinations/databases-postgres.slow.test.ts',
];
const OTHER_FILES = [
  'test/combinations/combinations.slow.test.ts',
  'test/combinations/mobile-targets.slow.test.ts',
  'test/packed/hooks.slow.test.ts',
  'test/packed/option-combinations.slow.test.ts',
];

function script(name: string): string {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return manifest.scripts[name] ?? '';
}

describe('the slow suite, split into the scripts CI runs', () => {
  it('holds exactly the slow files written here', async () => {
    const slow = (await listFiles(join(PACKAGE_DIR, 'test')))
      .filter((file) => file.endsWith('.slow.test.ts'))
      .map((file) => `test/${file}`);

    expect(slow).toEqual([...OTHER_FILES, ...DATABASE_FILES].sort());
  });

  it('leaves the database files, and only those, out of the first script', () => {
    const excluded =
      /^vitest run --config vitest\.combinations\.config\.ts --exclude "([^"]+)"$/.exec(
        script('test:combinations'),
      )?.[1];

    expect(excluded).toBeDefined();
    expect({
      databases: DATABASE_FILES.filter((file) => matchesGlob(file, excluded ?? '')),
      others: OTHER_FILES.filter((file) => matchesGlob(file, excluded ?? '')),
    }).toEqual({ databases: DATABASE_FILES, others: [] });
  });

  it('gives each database file a script of its own, and one script runs them all', () => {
    expect({
      postgres: script('test:combinations:postgres'),
      mongodb: script('test:combinations:mongodb'),
      all: script('test:combinations:all'),
    }).toEqual({
      postgres: `${RUN} test/combinations/databases-postgres.slow.test.ts`,
      mongodb: `${RUN} test/combinations/databases-mongodb.slow.test.ts`,
      all: RUN,
    });
  });
});
