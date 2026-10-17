import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { availableFeatures } from '../../src/manifest/select.js';
import type { Manifest } from '../../src/types.js';
import { buildCli, REPO_ROOT, runTool, scaffold } from '../support/combination-helpers.js';
import { locksPackage } from '../support/lockfile-lines.js';
import {
  expectBuiltHostMigrations,
  expectConfigTests,
  expectInstallsLintsBuilds,
  writeHostMigrationFixture,
} from './combination-scenarios.js';
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
 * Each case names its own time budget, below the 15 minutes this suite gives
 * a case by default. Alone on a machine a PostgreSQL case takes 80 to 110
 * seconds: an install from the shared store, two builds, and a unit and an
 * API suite that each end inside a minute. With other suites loading the same
 * machine the slowest one measured took about 330 seconds, 185 of them in its
 * unit suite. So a PostgreSQL case gets 12 minutes and each of its suites 6,
 * about twice the slowest measurement of each. A MongoDB case runs the whole
 * unit suite on one replica set per worker and then the API suite in band:
 * 500 to 924 seconds measured. Its budget is 30 minutes, the one case kind
 * above the default, because a cold machine also downloads the server binary,
 * and each suite gets 14.
 *
 * The two databases are separate files and separate CI jobs: the MongoDB cases
 * alone take longer than every other slow file together.
 */
const MINUTE_MS = 60 * 1000;
/**
 * How much of a failed suite's output the failure shows. Enough to hold the
 * server's log lines around a failed request, which the last few thousand
 * characters did not: a 503 could not be traced to the code that answered it.
 */
const FAILURE_OUTPUT_CHARS = 200_000;
export const POSTGRES_BUDGET = { budgetMs: 12 * MINUTE_MS, suiteMs: 6 * MINUTE_MS };
export const MONGODB_BUDGET = { budgetMs: 30 * MINUTE_MS, suiteMs: 14 * MINUTE_MS };

/** What `--yes` picks. Written by hand, and compared with the manifest below. */
export const DEFAULT_SELECTION = ['email-password', 'google', 'github', 'facebook'];

export interface DatabaseCase {
  name: string;
  database: string;
  /** `undefined` asks for every method the manifest offers. */
  features: string[] | undefined;
  flags?: string[];
  checkBuiltHostMigrations?: boolean;
  checkMobileWorkspaces?: boolean;
  budgetMs: number;
  /** The time one suite may take inside the case. */
  suiteMs: number;
}

/** Declares one database's cases. Call it once, from that database's slow file. */
export function describeDatabaseProjects(title: string, cases: DatabaseCase[]): void {
  let workspace = '';
  let manifest: Manifest;
  let built = { ok: false, output: '' };

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

  describe(title, () => {
    it('builds the CLI first', () => {
      expect(built.ok, built.output).toBe(true);
    });

    for (const testCase of cases) {
      it(
        `installs, builds and passes its own suites: ${testCase.name}`,
        async ({ signal }) => {
          const features = testCase.features ?? everything();
          const project = join(workspace, testCase.name.replace(/\W+/g, '-'));
          const scaffolded = await scaffold(project, features, [
            '--database',
            testCase.database,
            ...(testCase.flags ?? []),
          ]);
          expect(scaffolded.ok, scaffolded.output).toBe(true);

          if (testCase.checkBuiltHostMigrations) writeHostMigrationFixture(project);
          await expectInstallsLintsBuilds(project, inject('pnpmStore'), signal);
          if (testCase.checkBuiltHostMigrations) await expectBuiltHostMigrations(project, signal);
          if (testCase.checkMobileWorkspaces) {
            for (const script of ['lint', 'typecheck', 'test']) {
              const mobile = await runTool(
                'pnpm',
                [
                  '-r',
                  '--workspace-concurrency=1',
                  '--filter',
                  './mobile/*',
                  '--if-present',
                  'run',
                  script,
                ],
                { cwd: project, timeout: testCase.suiteMs, signal },
              );
              expect(mobile.ok, mobile.output.slice(-FAILURE_OUTPUT_CHARS)).toBe(true);
            }
          }
          // The lockfile the install wrote names nothing of the other database.
          const lockfile = readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8');
          const foreign = Object.entries(manifest.databases)
            .filter(([id]) => id !== testCase.database)
            .flatMap(([, entry]) => entry.packages);
          expect(
            foreign.filter((name) => lockfile.split('\n').some((line) => locksPackage(line, name))),
          ).toEqual([]);
          const availability = verifyFeatureAvailability(project, features);
          expect(availability.ok, availability.output).toBe(true);

          // The root configuration tests read the README, the compose files and
          // the setup scripts as this database left them.
          await expectConfigTests(project, signal);

          // The commands a person reads in the project's own README.
          // The signal ends the suite and everything it started when the case
          // runs out of its budget, so nothing is left running under the next one.
          const unit = await runTool('pnpm', ['--filter', 'backend', 'run', 'test'], {
            cwd: project,
            timeout: testCase.suiteMs,
            signal,
          });
          expect(unit.ok, unit.output.slice(-FAILURE_OUTPUT_CHARS)).toBe(true);
          const api = await runTool('pnpm', ['--filter', 'backend', 'run', 'test:e2e'], {
            cwd: project,
            timeout: testCase.suiteMs,
            signal,
          });
          expect(api.ok, api.output.slice(-FAILURE_OUTPUT_CHARS)).toBe(true);
        },
        testCase.budgetMs,
      );
    }
  });
}
