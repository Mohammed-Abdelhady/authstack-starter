import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { finishSetup } from '../../src/scaffold/setup.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { parseCliOptions } from '../../src/flags/options.js';
import { run } from '../../src/utils/exec.js';
import { FIXTURE_MANIFEST } from '../support/fixture.js';
import { setupFixture } from './setup-flow-fixture.js';

const roots: string[] = [];
const inherited = { ...process.env };
afterEach(async () => {
  process.env = { ...inherited };
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function activateOnInstall(root: string, fail = false): Promise<void> {
  const bin = join(dirname(root), 'bin/pnpm');
  const original = await readFile(bin, 'utf8');
  await writeFile(
    bin,
    original +
      `
if (args === 'install --frozen-lockfile') {
  const path = require('node:path');
  fs.mkdirSync('.husky/_', { recursive: true });
  fs.writeFileSync('.husky/_/h', '#!/bin/sh\\n');
  for (const name of ['pre-commit', 'pre-push', 'commit-msg']) {
    const hook = path.join('.husky/_', name);
    fs.writeFileSync(hook, '#!/bin/sh\\n');
    fs.chmodSync(hook, 0o755);
  }
  require('node:child_process').spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: process.cwd(), env: process.env });
  if (${fail}) { process.stderr.write('postinstall failed'); process.exit(1); }
}
`,
  );
}

const CASES = [
  {
    name: 'git unavailable',
    gitUnavailable: true,
    rejectCommit: false,
    activate: false,
    installFails: false,
    git: { status: 'failed', reason: 'spawn git ENOENT' },
    install: { status: 'installed' },
    exitCode: 1,
    hooks: { included: true, active: false, activationCommand: 'git init && pnpm exec husky' },
  },
  {
    name: 'first commit rejected then hooks activated',
    gitUnavailable: false,
    rejectCommit: true,
    activate: true,
    installFails: false,
    git: { status: 'failed', reason: 'commit blocked' },
    install: { status: 'installed' },
    exitCode: 1,
    hooks: { included: true, active: true },
  },
  {
    name: 'successful activation',
    gitUnavailable: false,
    rejectCommit: false,
    activate: true,
    installFails: false,
    git: { status: 'created' },
    install: { status: 'installed' },
    exitCode: 0,
    hooks: { included: true, active: true },
  },
  {
    name: 'postinstall failed after hook files existed',
    gitUnavailable: false,
    rejectCommit: false,
    activate: true,
    installFails: true,
    git: { status: 'created' },
    install: { status: 'failed', reason: 'postinstall failed' },
    exitCode: 1,
    hooks: { included: true, active: false, activationCommand: 'pnpm install' },
  },
];

it.each(['strict', 'standard'])(
  'returns actual git and lifecycle failures under %s',
  async (rules) => {
    for (const entry of CASES) {
      const target = await setupFixture(roots, inherited);
      if (entry.rejectCommit) {
        await run('git', ['init', '--initial-branch=test', target], target);
        await mkdir(join(target, '.git/hooks'), { recursive: true });
        await writeFile(
          join(target, '.git/hooks/pre-commit'),
          '#!/bin/sh\necho "commit blocked" >&2\nexit 1\n',
        );
        await chmod(join(target, '.git/hooks/pre-commit'), 0o755);
      }
      if (entry.activate) await activateOnInstall(target, entry.installFails);
      if (entry.gitUnavailable) process.env.PATH = join(dirname(target), 'bin');
      const plan = resolvePlan(FIXTURE_MANIFEST, {
        features: ['email-password'],
        rules: rules === 'strict' ? 'strict' : 'standard',
      });
      plan.options = ['docker'];
      expect(
        await finishSetup(target, FIXTURE_MANIFEST, plan, parseCliOptions([target, '--yes']), {
          ok: true,
        }),
        entry.name,
      ).toEqual({
        files: { count: 9, instructions: ['AGENTS.md', 'CLAUDE.md'] },
        rules,
        lockfile: { status: 'updated' },
        git: entry.git,
        install: entry.install,
        exitCode: entry.exitCode,
        hooks: entry.hooks,
        checksRun: [
          'template pruning',
          'dangling references',
          'pnpm version',
          'lockfile update',
          'git repository and first commit',
          'dependency installation',
        ],
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
        ],
        nextSteps: [
          `cd ${target}`,
          ...(entry.installFails ? ['pnpm install'] : []),
          'cp .env.docker.example .env.docker',
          'docker compose --env-file .env.docker up -d',
        ],
        docs: ['README.md', 'docs/README.md', 'docs/setup/setup-smtp.md'],
      });
    }
  },
);
