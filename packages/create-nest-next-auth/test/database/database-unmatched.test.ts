import { afterEach, describe, expect, it } from 'vitest';
import {
  removeDatabaseJson,
  renameDatabaseFiles,
  rewriteDatabaseText,
  writeDatabaseEnvExamples,
} from '../../src/prune/database.js';
import { prune } from '../../src/prune/index.js';
import { resolveOwnership, type Ownership } from '../../src/manifest/ownership.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import type { RulesPolicy } from '../../src/types.js';
import { FIXTURE_MANIFEST, TOOLING_MANIFEST } from '../support/fixture.js';
import { database, project, read, removeProjects } from './database-fixture.js';

afterEach(removeProjects);

describe('the commands of the chosen database', () => {
  it('take the plain names in place, once the other database gave them up', async () => {
    const root = await project({
      'backend/package.json': JSON.stringify({
        scripts: {
          test: 'jest',
          'test:e2e': 'jest first',
          'test:e2e:second': 'jest second',
          seed: 'ts-node seed.ts',
        },
      }),
    });
    const reports: string[] = [];

    const edited = await removeDatabaseJson(
      root,
      [database({ label: 'First', scripts: ['test:e2e'] })],
      [database({ scriptRenames: { 'test:e2e:second': 'test:e2e' } })],
      (rule) => reports.push(rule),
    );
    const scripts: unknown = JSON.parse(await read(root, 'backend/package.json'));

    expect({ edited, reports, scripts: JSON.stringify(scripts) }).toEqual({
      edited: ['backend/package.json'],
      reports: [],
      // The renamed command stays where it was: the order is part of the file.
      scripts: '{"scripts":{"test":"jest","test:e2e":"jest second","seed":"ts-node seed.ts"}}',
    });
  });

  it('are refused a name that is still taken, and the file is left as it was', async () => {
    const before = '{"scripts":{"test:e2e":"jest first","test:e2e:second":"jest second"}}';
    const root = await project({ 'backend/package.json': before });

    await expect(
      removeDatabaseJson(
        root,
        [],
        [database({ scriptRenames: { 'test:e2e:second': 'test:e2e' } })],
      ),
    ).rejects.toThrow('Second renames the script "test:e2e:second" to "test:e2e"');
    expect(await read(root, 'backend/package.json')).toBe(before);
  });
});

describe('a database rule that finds nothing to change', () => {
  it('is reported by name, and every rule that does find its target is still applied', async () => {
    const root = await project({
      'package.json': JSON.stringify({ devDependencies: { pg: '8' } }),
      'backend/package.json': JSON.stringify({
        scripts: { 'migration:up': 'migrate up' },
        jest: { globalSetup: 'setup.ts' },
      }),
      'docs/a.md': 'run it',
    });
    const reports: string[] = [];
    const report = (rule: string): void => {
      reports.push(rule);
    };
    const removed = [
      database({
        label: 'First',
        packages: ['pg', 'ghost-package'],
        scripts: ['migration:up', 'ghost:script'],
        jsonKeys: {
          'backend/package.json': [
            ['jest', 'globalSetup'],
            ['jest', 'ghost'],
          ],
          'missing.json': [['a', 'b']],
        },
      }),
    ];
    const kept = [
      database({
        scriptRenames: { 'ghost:long': 'ghost' },
        renames: { 'ghost.yml': 'compose.yml' },
        rewrites: [
          { files: ['docs/**'], from: 'ghost text', to: 'x' },
          { files: ['docs/**'], from: 'run it', to: 'ran it' },
        ],
        envExamples: [{ path: '.env.docker.example', lines: ['A=1'] }],
      }),
    ];

    await writeDatabaseEnvExamples(root, kept, report);
    await removeDatabaseJson(root, removed, kept, report);
    await renameDatabaseFiles(root, kept, report);
    await rewriteDatabaseText(root, kept, report);

    expect({
      reports,
      root: await read(root, 'package.json'),
      backend: JSON.parse(await read(root, 'backend/package.json')),
      doc: await read(root, 'docs/a.md'),
    }).toEqual({
      reports: [
        'Second: environment example ".env.docker.example" is not there',
        'Second: script "ghost:long" is not in backend/package.json',
        'key jest.ghost of backend/package.json is not there',
        'key a.b of missing.json: the file is not there',
        'package "ghost-package" is in no package manifest',
        'script "ghost:script" is not in backend/package.json',
        'Second: rename source "ghost.yml" is not there',
        'Second: no file holds the text "ghost text"',
      ],
      root: '{\n  "devDependencies": {}\n}\n',
      backend: { scripts: {}, jest: {} },
      doc: 'ran it',
    });
  });

  it('is not reported when every rule found its target', async () => {
    const root = await project({
      'backend/package.json': JSON.stringify({
        dependencies: { pg: '8' },
        scripts: { 'migration:up': 'migrate up', 'seed:second': 'seed' },
        jest: { globalSetup: 'setup.ts' },
      }),
      'compose.second.yml': 'second',
      '.env.example': 'PORT=1\n',
    });
    const reports: string[] = [];
    const report = (rule: string): void => {
      reports.push(rule);
    };
    const removed = [
      database({
        packages: ['pg'],
        scripts: ['migration:up'],
        jsonKeys: { 'backend/package.json': [['jest', 'globalSetup']] },
      }),
    ];
    const kept = [
      database({
        scriptRenames: { 'seed:second': 'seed' },
        renames: { 'compose.second.yml': 'compose.yml' },
        rewrites: [{ files: ['compose.yml'], from: 'second', to: 'chosen' }],
        envExamples: [{ path: '.env.example', lines: ['A=1'] }],
      }),
    ];

    await writeDatabaseEnvExamples(root, kept, report);
    await removeDatabaseJson(root, removed, kept, report);
    await renameDatabaseFiles(root, kept, report);
    await rewriteDatabaseText(root, kept, report);

    expect({ reports, compose: await read(root, 'compose.yml') }).toEqual({
      reports: [],
      compose: 'chosen',
    });
  });
});

describe('a file one database gives up and the chosen one takes the name of', () => {
  it('is not counted as deleted, so a root command that names it stays', async () => {
    const root = await project({
      'package.json': JSON.stringify({
        scripts: { up: 'docker compose -f compose.yml up', gone: 'node only-first.js' },
      }),
      'compose.yml': 'first',
      'compose.second.yml': 'second',
      'only-first.js': '',
    });
    const manifest = {
      ...FIXTURE_MANIFEST,
      databases: {
        first: database({
          label: 'First',
          default: true,
          files: ['compose.yml', 'only-first.js'],
        }),
        second: database({ renames: { 'compose.second.yml': 'compose.yml' } }),
      },
    };

    const result = await prune(
      root,
      manifest,
      Object.keys(manifest.features),
      Object.keys(manifest.options),
      undefined,
      undefined,
      ['second'],
    );
    const scripts: unknown = JSON.parse(await read(root, 'package.json'));

    expect({
      deleted: result.deletedFiles,
      scripts,
      compose: await read(root, 'compose.yml'),
      dangling: result.dangling,
      unmatched: result.unmatchedDatabaseRules,
    }).toEqual({
      deleted: ['only-first.js'],
      scripts: { scripts: { up: 'docker compose -f compose.yml up' } },
      // The pruner formats what it renamed.
      compose: 'second\n',
      dangling: [],
      unmatched: [],
    });
  });
});

describe('a rule that found nothing, by what the project left out', () => {
  const manifest = {
    ...TOOLING_MANIFEST,
    databases: {
      first: database({ label: 'First', default: true }),
      second: database({ rewrites: [{ files: ['docs/**'], from: 'ghost text', to: 'x' }] }),
    },
  };
  const RULE = 'Second: no file holds the text "ghost text"';
  const everyFeature = Object.keys(manifest.features).filter((id) => id !== 'gamma');
  const everyClient = resolveOwnership(
    manifest,
    resolvePlan(manifest, { targets: Object.keys(manifest.targets), projectName: 'app' }),
  );

  async function unexplained(
    features: string[],
    rules: RulesPolicy = 'strict',
    ownership: Ownership = everyClient,
  ): Promise<{ unmatched: string[]; unexplained: string[] }> {
    const root = await project({ 'package.json': '{}', 'docs/a.md': 'run it' });
    const result = await prune(root, manifest, features, [], rules, ownership, ['second']);
    return {
      unmatched: result.unmatchedDatabaseRules,
      unexplained: result.unexplainedDatabaseRules,
    };
  }

  it('has no explanation when every method, option and client is kept', async () => {
    // "gamma" is planned: no project can have it, so leaving it out explains nothing.
    expect(await unexplained(everyFeature)).toEqual({ unmatched: [RULE], unexplained: [RULE] });
  });

  it('is explained by a sign-in method that was left out', async () => {
    expect(await unexplained(['email-password', 'alpha'])).toEqual({
      unmatched: [RULE],
      unexplained: [],
    });
  });

  it('is explained by the standard rules level, which rewrites files', async () => {
    expect(await unexplained(everyFeature, 'standard')).toEqual({
      unmatched: [RULE],
      unexplained: [],
    });
  });

  it('is explained by a client that was left out', async () => {
    const webOnly: Ownership = { ...everyClient, removedFiles: ['mobile/**'] };

    expect(await unexplained(everyFeature, 'strict', webOnly)).toEqual({
      unmatched: [RULE],
      unexplained: [],
    });
  });
});
