import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { emptyDatabase } from '../../src/manifest/validate-dimensions.js';
import { removeDatabaseJson } from '../../src/prune/database.js';
import { setProjectName } from '../../src/scaffold/package-json.js';
import type { Database } from '../../src/types.js';

/** A database left out of the project, with what it owns in the backend manifest. */
function leftOut(owned: Partial<Database>): Database[] {
  return [{ ...emptyDatabase(), label: 'PostgreSQL', ...owned }];
}
const POSTGRES_PACKAGES = ['embedded-postgres', 'kysely', 'pg', '@types/pg'];

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('removes browser dependencies and retains runnable frontend dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-package-'));
  roots.push(root);
  await mkdir(join(root, 'frontend'));
  await writeFile(join(root, 'package.json'), '{"name":"template"}');
  await writeFile(
    join(root, 'frontend/package.json'),
    JSON.stringify({
      scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
      devDependencies: {
        '@playwright/test': '^1.0.0',
        playwright: '^1.0.0',
        '@axe-core/playwright': '^4.0.0',
        vitest: '^5.0.0',
        typescript: '^5.0.0',
      },
    }),
  );
  await setProjectName(root, 'my-app');
  expect(JSON.parse(await readFile(join(root, 'frontend/package.json'), 'utf8'))).toEqual({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^5.0.0', typescript: '^5.0.0' },
  });
});

it('accepts a frontend without optional dependency or script groups', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-package-'));
  roots.push(root);
  await mkdir(join(root, 'frontend'));
  await writeFile(join(root, 'package.json'), '{"name":"template"}');
  await writeFile(join(root, 'frontend/package.json'), '{"name":"frontend"}');

  await setProjectName(root, 'my-app');

  expect(JSON.parse(await readFile(join(root, 'frontend/package.json'), 'utf8'))).toEqual({
    name: 'frontend',
  });
});

it('removes the tooling of a database that was left out and keeps the rest in order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-package-'));
  roots.push(root);
  await mkdir(join(root, 'frontend'));
  await mkdir(join(root, 'backend'));
  await writeFile(join(root, 'package.json'), '{"name":"template"}');
  await writeFile(join(root, 'frontend/package.json'), '{"name":"frontend"}');
  await writeFile(
    join(root, 'backend/package.json'),
    JSON.stringify({
      name: 'backend',
      dependencies: { mongoose: '^8.0.0' },
      devDependencies: {
        '@types/node': '^22.0.0',
        '@types/pg': '8.23.1',
        'embedded-postgres': '18.4.0-beta.17',
        jest: '^30.0.0',
        kysely: '0.28.17',
        'mongodb-memory-server': '^11.0.0',
        pg: '8.23.1',
      },
    }),
  );

  await removeDatabaseJson(root, leftOut({ packages: POSTGRES_PACKAGES }));

  expect(JSON.parse(await readFile(join(root, 'backend/package.json'), 'utf8'))).toEqual({
    name: 'backend',
    dependencies: { mongoose: '^8.0.0' },
    devDependencies: {
      '@types/node': '^22.0.0',
      jest: '^30.0.0',
      'mongodb-memory-server': '^11.0.0',
    },
  });
});

it('leaves a backend manifest without that tooling byte-identical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-package-'));
  roots.push(root);
  await mkdir(join(root, 'frontend'));
  await mkdir(join(root, 'backend'));
  await writeFile(join(root, 'package.json'), '{"name":"template"}');
  await writeFile(join(root, 'frontend/package.json'), '{"name":"frontend"}');
  const backend = '{"name":"backend","devDependencies":{"jest":"^30.0.0"}}';
  await writeFile(join(root, 'backend/package.json'), backend);

  await setProjectName(root, 'my-app');
  await removeDatabaseJson(root, leftOut({ packages: POSTGRES_PACKAGES }));

  expect(await readFile(join(root, 'backend/package.json'), 'utf8')).toBe(backend);
});

it('removes the packages of a database that was left out from production and development alike', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-package-'));
  roots.push(root);
  await mkdir(join(root, 'frontend'));
  await mkdir(join(root, 'backend'));
  await writeFile(join(root, 'package.json'), '{"name":"template"}');
  await writeFile(join(root, 'frontend/package.json'), '{"name":"frontend"}');
  await writeFile(
    join(root, 'backend/package.json'),
    JSON.stringify({ dependencies: { pg: '8.23.1' }, devDependencies: { kysely: '0.28.17' } }),
  );

  await removeDatabaseJson(root, leftOut({ packages: POSTGRES_PACKAGES }));

  expect(JSON.parse(await readFile(join(root, 'backend/package.json'), 'utf8'))).toEqual({
    dependencies: {},
    devDependencies: {},
  });
});

it('removes the backend commands of a database that was left out and keeps every other one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-package-'));
  roots.push(root);
  await mkdir(join(root, 'frontend'));
  await mkdir(join(root, 'backend'));
  await writeFile(join(root, 'package.json'), '{"name":"template"}');
  await writeFile(join(root, 'frontend/package.json'), '{"name":"frontend"}');
  await writeFile(
    join(root, 'backend/package.json'),
    JSON.stringify({
      name: 'backend',
      scripts: {
        'test:e2e': 'node ./test/run-jest.mjs --config ./test/jest-e2e.json --runInBand',
        'test:e2e:postgres':
          'node ./test/run-jest.mjs --config ./test/jest-e2e-postgres.json --runInBand',
        'migration:up': 'migrate-mongo up',
        'migration:postgres:up':
          'ts-node src/common/persistence/postgres/postgres-migrate.cli.ts up',
        'migration:postgres:status':
          'ts-node src/common/persistence/postgres/postgres-migrate.cli.ts status',
        'migration:postgres:adopt-host':
          'ts-node src/common/persistence/postgres/postgres-migrate.cli.ts adopt-host',
        seed: 'ts-node src/database/seeds/index.ts',
      },
      dependencies: { kysely: '0.28.17', pg: '8.23.1' },
    }),
  );

  await removeDatabaseJson(
    root,
    leftOut({
      scripts: [
        'test:e2e:postgres',
        'migration:postgres:up',
        'migration:postgres:status',
        'migration:postgres:adopt-host',
      ],
    }),
  );

  expect(JSON.parse(await readFile(join(root, 'backend/package.json'), 'utf8'))).toEqual({
    name: 'backend',
    scripts: {
      'test:e2e': 'node ./test/run-jest.mjs --config ./test/jest-e2e.json --runInBand',
      'migration:up': 'migrate-mongo up',
      seed: 'ts-node src/database/seeds/index.ts',
    },
    dependencies: { kysely: '0.28.17', pg: '8.23.1' },
  });
});

it('removes the mobile engine from the backend, whose only users stay in this repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-package-'));
  roots.push(root);
  await mkdir(join(root, 'frontend'));
  await mkdir(join(root, 'backend'));
  await writeFile(join(root, 'package.json'), '{"name":"template"}');
  await writeFile(join(root, 'frontend/package.json'), '{"name":"frontend"}');
  await writeFile(
    join(root, 'backend/package.json'),
    JSON.stringify({
      name: 'backend',
      devDependencies: {
        '@app/native-auth': 'workspace:*',
        '@app/sdk': 'workspace:*',
        jest: '^30.0.0',
      },
    }),
  );

  await setProjectName(root, 'my-app');

  expect(JSON.parse(await readFile(join(root, 'backend/package.json'), 'utf8'))).toEqual({
    name: 'backend',
    devDependencies: { '@app/sdk': 'workspace:*', jest: '^30.0.0' },
  });
});
