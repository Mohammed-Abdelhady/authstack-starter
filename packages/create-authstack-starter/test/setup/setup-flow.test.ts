import { EXPECTED_MISSING_PNPM_REASON } from './setup-flow-expectations.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { finishSetup } from '../../src/scaffold/setup.js';
import { CASES } from './setup-flow-cases.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { parseCliOptions } from '../../src/flags/options.js';
import { FIXTURE_MANIFEST } from '../support/fixture.js';
import { setupFixture } from './setup-flow-fixture.js';

const roots: string[] = [];
const inherited = { ...process.env };
afterEach(async () => {
  process.env = { ...inherited };
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(['strict', 'standard'])(
  'returns observed setup outcomes for every flag combination under %s',
  async (rules) => {
    for (const entry of CASES) {
      const target = await setupFixture(roots, inherited, entry.fail);
      const options = parseCliOptions([target, '--yes', ...entry.flags]);
      const plan = resolvePlan(FIXTURE_MANIFEST, {
        features: ['email-password'],
        rules: rules === 'strict' ? 'strict' : 'standard',
      });
      plan.options = ['docker'];
      if (!entry.lock.ok) await rm(join(target, 'pnpm-lock.yaml'));
      const result = await finishSetup(target, FIXTURE_MANIFEST, plan, options, entry.lock);
      expect(
        {
          files: result.files,
          rules: result.rules,
          git: result.git,
          install: result.install,
          exitCode: result.exitCode,
          hooks: result.hooks,
          checksRun: result.checksRun,
          skipped: result.skipped,
          docs: result.docs,
          lockfile: result.lockfile,
          nextSteps: result.nextSteps,
        },
        entry.name,
      ).toEqual({
        files: { count: entry.lock.ok ? 9 : 8, instructions: ['AGENTS.md', 'CLAUDE.md'] },
        rules,
        git: entry.expected.git,
        install: entry.expected.install,
        exitCode: entry.expected.exitCode,
        hooks: {
          included: true,
          active: false,
          activationCommand: entry.expected.activationCommand,
        },
        checksRun: entry.expected.checksRun,
        skipped: [
          { check: 'lint', reason: 'Not run by the installer.' },
          { check: 'typecheck', reason: 'Not run by the installer.' },
          { check: 'tests', reason: 'Not run by the installer.' },
          { check: 'build', reason: 'Not run by the installer.' },
          {
            check: 'banned-construct scan',
            reason:
              rules === 'standard' ? 'Disabled under standard rules.' : 'Not run by the installer.',
          },
          {
            check: 'file length ceiling',
            reason:
              rules === 'standard' ? 'Disabled under standard rules.' : 'Not run by the installer.',
          },
          ...entry.expected.skipped,
        ],
        docs: ['README.md', 'docs/README.md', 'docs/setup/setup-smtp.md'],
        lockfile: entry.lock.ok
          ? { status: 'updated' }
          : {
              status: 'removed',
              reason: entry.name.includes('missing pnpm')
                ? EXPECTED_MISSING_PNPM_REASON
                : 'registry error',
            },
        nextSteps: [
          `cd ${target}`,
          ...(entry.expected.install.status === 'installed' ? [] : ['pnpm install']),
          'cp .env.docker.example .env.docker',
          'docker compose --env-file .env.docker up -d',
        ],
      });
    }
  },
);
