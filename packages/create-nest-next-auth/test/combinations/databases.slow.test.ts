import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { availableFeatures } from '../../src/manifest/select.js';
import type { Manifest } from '../../src/types.js';
import { buildCli, REPO_ROOT, runTool, scaffold } from '../support/combination-helpers.js';
import { expectConfigTests, expectInstallsLintsBuilds } from './combination-scenarios.js';
import { verifyFeatureAvailability } from './feature-runtime.js';

/**
 * A generated project of each database, from an empty folder: installed from
 * its own pruned lockfile into the suite's own pnpm store, typechecked,
 * linted, built, and run through its own unit and API suites. Nothing is
 * borrowed from this repository's node_modules.
 *
 * The PostgreSQL projects need no database service: their suites start the
 * server the `embedded-postgres` development dependency carries, with a data
 * folder of their own that they remove. The MongoDB project starts
 * `mongodb-memory-server` the same way.
 *
 * Each case names its own time budget. A PostgreSQL case is an install, two
 * builds and suites that take under a minute. The MongoDB case runs the whole
 * unit suite on one replica set per worker and then the API suite in band,
 * which is most of its budget.
 */
const MINUTE_MS = 60 * 1000;

interface DatabaseCase {
  name: string;
  database: string;
  /** `undefined` asks for every method the manifest offers. */
  features: string[] | undefined;
  budgetMs: number;
  /** The time one suite may take inside the case. */
  suiteMs: number;
}

const CASES: DatabaseCase[] = [
  {
    name: 'PostgreSQL with every sign-in method',
    database: 'postgres',
    features: undefined,
    budgetMs: 12 * MINUTE_MS,
    suiteMs: 4 * MINUTE_MS,
  },
  {
    name: 'PostgreSQL with every optional method left out',
    database: 'postgres',
    features: ['email-password'],
    budgetMs: 10 * MINUTE_MS,
    suiteMs: 4 * MINUTE_MS,
  },
  {
    name: 'PostgreSQL with magic link, passkeys and one provider',
    database: 'postgres',
    features: ['email-password', 'magic-link', 'passkeys', 'github'],
    budgetMs: 10 * MINUTE_MS,
    suiteMs: 4 * MINUTE_MS,
  },
  {
    name: 'MongoDB with every sign-in method',
    database: 'mongodb',
    features: undefined,
    budgetMs: 30 * MINUTE_MS,
    suiteMs: 14 * MINUTE_MS,
  },
];

let workspace = '';
let manifest: Manifest;
let built = { ok: false, output: '' };

/** True for a lockfile line that resolves `name`: `  name@1.0.0:` or `      name:`. */
function locks(line: string, name: string): boolean {
  const entry = line.trim().replace(/^'/, '');
  return entry.startsWith(`${name}@`) || entry === `${name}:` || entry === `'${name}':`;
}

function everything(): string[] {
  return availableFeatures(manifest)
    .filter(({ feature }) => feature.kind !== 'hidden')
    .map(({ id }) => id);
}

beforeAll(async () => {
  workspace = mkdtempSync(join(inject('combinationRoot'), 'databases-'));
  manifest = await loadManifest(REPO_ROOT);
  built = await buildCli();
});

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

describe('generated projects by database', () => {
  it('builds the CLI first', () => {
    expect(built.ok, built.output).toBe(true);
  });

  for (const testCase of CASES) {
    it(
      `installs, builds and passes its own suites: ${testCase.name}`,
      async () => {
        const features = testCase.features ?? everything();
        const project = join(workspace, testCase.name.replace(/\W+/g, '-'));
        const scaffolded = await scaffold(project, features, ['--database', testCase.database]);
        expect(scaffolded.ok, scaffolded.output).toBe(true);

        await expectInstallsLintsBuilds(project, inject('pnpmStore'));
        // The lockfile the install wrote names nothing of the other database.
        const lockfile = readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8');
        const foreign = Object.entries(manifest.databases)
          .filter(([id]) => id !== testCase.database)
          .flatMap(([, entry]) => entry.packages);
        expect(
          foreign.filter((name) => lockfile.split('\n').some((line) => locks(line, name))),
        ).toEqual([]);
        const availability = verifyFeatureAvailability(project, features);
        expect(availability.ok, availability.output).toBe(true);

        // The root configuration tests read the README, the compose files and
        // the setup scripts as this database left them.
        await expectConfigTests(project);

        // The commands a person reads in the project's own README.
        const unit = await runTool('pnpm', ['--filter', 'backend', 'run', 'test'], {
          cwd: project,
          timeout: testCase.suiteMs,
        });
        expect(unit.ok, unit.output.slice(-6000)).toBe(true);
        const api = await runTool('pnpm', ['--filter', 'backend', 'run', 'test:e2e'], {
          cwd: project,
          timeout: testCase.suiteMs,
        });
        expect(api.ok, api.output.slice(-6000)).toBe(true);
      },
      testCase.budgetMs,
    );
  }
});
