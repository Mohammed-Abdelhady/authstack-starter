import { afterEach, describe, expect, it } from 'vitest';
import {
  removeDatabaseJson,
  renameDatabaseFiles,
  rewriteDatabaseText,
  splitDatabases,
} from '../../src/prune/database.js';
import type { Manifest } from '../../src/types.js';
import { database, project, read, removeProjects } from './database-fixture.js';

afterEach(removeProjects);

describe('which databases a project carries', () => {
  const manifest = {
    databases: {
      first: database({ label: 'First', default: true }),
      second: database({ label: 'Second' }),
      third: database({ label: 'Third', status: 'planned' }),
    },
  } satisfies Pick<Manifest, 'databases'>;

  it('keeps the chosen one and removes every other, a planned one included', () => {
    const split = splitDatabases(manifest, ['second']);

    expect({
      kept: split.kept.map(({ label }) => label),
      removed: split.removed.map(({ label }) => label),
    }).toEqual({ kept: ['Second'], removed: ['First', 'Third'] });
  });
});

describe('what a database that was left out loses in JSON files', () => {
  it('drops its packages from every group of every package manifest, and nothing else', async () => {
    const root = await project({
      'package.json': JSON.stringify({ devDependencies: { kysely: '1', prettier: '3' } }),
      'backend/package.json': JSON.stringify({
        dependencies: { pg: '8', express: '5' },
        devDependencies: { '@types/pg': '8', jest: '30' },
        optionalDependencies: { pg: '8' },
        peerDependencies: { kysely: '1', rxjs: '7' },
      }),
    });

    const edited = await removeDatabaseJson(root, [
      database({ packages: ['pg', 'kysely', '@types/pg'] }),
    ]);

    expect({
      edited,
      root: JSON.parse(await read(root, 'package.json')),
      backend: JSON.parse(await read(root, 'backend/package.json')),
    }).toEqual({
      edited: ['backend/package.json', 'package.json'],
      root: { devDependencies: { prettier: '3' } },
      backend: {
        dependencies: { express: '5' },
        devDependencies: { jest: '30' },
        optionalDependencies: {},
        peerDependencies: { rxjs: '7' },
      },
    });
  });

  it('drops its backend commands by name and keeps a command of the same name elsewhere', async () => {
    const root = await project({
      'package.json': JSON.stringify({ scripts: { 'migration:up': 'echo root' } }),
      'backend/package.json': JSON.stringify({
        scripts: { 'migration:up': 'migrate-mongo up', seed: 'ts-node seed.ts' },
      }),
    });

    await removeDatabaseJson(root, [database({ scripts: ['migration:up'] })]);

    expect({
      root: JSON.parse(await read(root, 'package.json')),
      backend: JSON.parse(await read(root, 'backend/package.json')),
    }).toEqual({
      root: { scripts: { 'migration:up': 'echo root' } },
      backend: { scripts: { seed: 'ts-node seed.ts' } },
    });
  });

  it('drops the keys it lists by path, at any depth, and leaves a missing one alone', async () => {
    const root = await project({
      'backend/package.json': JSON.stringify({
        jest: { globalSetup: 'setup.ts', rootDir: 'src' },
      }),
      'backend/nest-cli.json': JSON.stringify({
        compilerOptions: { deleteOutDir: true, assets: [{ include: '*.sql' }] },
      }),
    });

    const edited = await removeDatabaseJson(root, [
      database({
        jsonKeys: {
          'backend/package.json': [
            ['jest', 'globalSetup'],
            ['jest', 'globalTeardown'],
            ['absent', 'deeper'],
          ],
          'backend/nest-cli.json': [['compilerOptions', 'assets']],
          'backend/not-there.json': [['anything']],
        },
      }),
    ]);

    expect({
      edited,
      manifest: JSON.parse(await read(root, 'backend/package.json')),
      nest: JSON.parse(await read(root, 'backend/nest-cli.json')),
    }).toEqual({
      edited: ['backend/nest-cli.json', 'backend/package.json'],
      manifest: { jest: { rootDir: 'src' } },
      nest: { compilerOptions: { deleteOutDir: true } },
    });
  });

  it('names the file when one is not JSON', async () => {
    const root = await project({ 'backend/package.json': '{ not json' });

    await expect(removeDatabaseJson(root, [database({ packages: ['pg'] })])).rejects.toThrow(
      /Could not parse backend\/package\.json/,
    );
  });
});

describe('the plain names the chosen database takes', () => {
  it('moves a file to the name the other database left free', async () => {
    const root = await project({ 'test/jest-e2e-second.json': '{"second":true}' });

    const moved = await renameDatabaseFiles(root, [
      database({ renames: { 'test/jest-e2e-second.json': 'test/jest-e2e.json' } }),
    ]);

    expect({
      moved,
      target: await read(root, 'test/jest-e2e.json'),
      source: await read(root, 'test/jest-e2e-second.json').catch(() => 'gone'),
    }).toEqual({ moved: ['test/jest-e2e.json'], target: '{"second":true}', source: 'gone' });
  });

  it('refuses a name that is still taken and leaves both files as they were', async () => {
    const root = await project({
      'compose.second.yml': 'second',
      'compose.yml': 'first',
    });

    await expect(
      renameDatabaseFiles(root, [database({ renames: { 'compose.second.yml': 'compose.yml' } })]),
    ).rejects.toThrow('Second renames "compose.second.yml" to "compose.yml", which is still there');
    expect({
      source: await read(root, 'compose.second.yml'),
      target: await read(root, 'compose.yml'),
    }).toEqual({ source: 'second', target: 'first' });
  });
});

describe('the text that told the chosen database apart', () => {
  it('replaces every occurrence in the files the rule names and in no other', async () => {
    const root = await project({
      'backend/package.json':
        '{"scripts":{"test:e2e:second":"jest e2e-second","x":"test:e2e:second"}}',
      'docs/a.md': 'run test:e2e:second',
      'other/b.md': 'run test:e2e:second',
    });

    const edited = await rewriteDatabaseText(root, [
      database({
        rewrites: [
          { files: ['backend/package.json', 'docs/**'], from: 'test:e2e:second', to: 'test:e2e' },
        ],
      }),
    ]);

    expect({
      edited,
      manifest: await read(root, 'backend/package.json'),
      doc: await read(root, 'docs/a.md'),
      other: await read(root, 'other/b.md'),
    }).toEqual({
      edited: ['backend/package.json', 'docs/a.md'],
      manifest: '{"scripts":{"test:e2e":"jest e2e-second","x":"test:e2e"}}',
      doc: 'run test:e2e',
      other: 'run test:e2e:second',
    });
  });

  it('applies the rules in order, so a later one can rely on an earlier one', async () => {
    const root = await project({ 'docs/a.md': 'one' });

    await rewriteDatabaseText(root, [
      database({
        rewrites: [
          { files: ['docs/a.md'], from: 'one', to: 'two' },
          { files: ['docs/a.md'], from: 'two', to: 'three' },
        ],
      }),
    ]);

    expect(await read(root, 'docs/a.md')).toBe('three');
  });
});
