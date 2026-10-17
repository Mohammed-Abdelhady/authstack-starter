import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { isRecord } from '../../../src/manifest/read.js';
import { listFiles } from '../../../src/utils/fs.js';
import { matchesGlob } from '../../../src/utils/glob.js';
import type { Packed } from '../packed-cli.js';
import {
  expectSupportedActionInputs,
  expectNodeVersions,
  jobsOf,
  PNPM_SETUP_ACTION,
  PNPM_SETUP_WITH,
  readWorkflow,
  stepsOf,
} from '../../support/ci-workflow-helpers.js';

function readPackage(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(value)) throw new Error('Package must be a mapping');
  return value;
}

export async function checkGeneratedCi(packed: Packed, preset: string): Promise<void> {
  const project = join(packed.workspace, `ci-${preset}`);
  const result = spawnSync(
    process.execPath,
    [packed.cli, project, '--yes', '--no-install', '--no-git', '--preset', preset],
    { cwd: packed.workspace, encoding: 'utf8' },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const workflow = readWorkflow(join(project, '.github/workflows/ci.yml'));
  const jobs = jobsOf(workflow);
  expect(Object.keys(jobs)).toEqual(['range-scan', 'quality', 'api', 'dependency-audit']);
  expectNodeVersions(jobs['range-scan']);
  expectNodeVersions(jobs.quality, [22, 24]);
  expectNodeVersions(jobs.api, [22, 24]);
  expect(workflow.on).toEqual({
    pull_request: {
      branches: ['staging', 'master', 'main'],
      types: ['opened', 'synchronize', 'reopened'],
    },
    push: { branches: ['staging', 'master', 'main'] },
  });
  expect(existsSync(join(project, '.github/CODEOWNERS'))).toBe(false);
  const qualitySteps = stepsOf(jobs.quality);
  expect(qualitySteps[2]).toMatchObject({
    uses: PNPM_SETUP_ACTION,
    with: PNPM_SETUP_WITH,
  });
  // The API job is the project's own: it installs and runs the suite of its database.
  expect(
    stepsOf(jobs.api)
      .filter((step) => typeof step.run === 'string')
      .map((step) => step.run)
      .slice(-2),
  ).toEqual(['node scripts/ci.mjs --install', 'node scripts/ci.mjs --api']);
  expect(readFileSync(join(project, '.github/workflows/ci.yml'), 'utf8')).not.toMatch(
    /repository-only|No runner has timed/,
  );
  const trusted = readWorkflow(join(project, '.github/workflows/trusted-scan.yml'));
  expectSupportedActionInputs([
    { name: `${preset} generated CI workflow`, workflow },
    { name: `${preset} generated trusted scan workflow`, workflow: trusted },
  ]);
  expect(Object.keys(jobsOf(trusted))).toEqual(['trusted-range']);
  expect(trusted.on).toEqual({
    pull_request_target: {
      branches: ['staging', 'master', 'main'],
      types: ['opened', 'synchronize', 'reopened', 'edited'],
    },
  });
  const trustedSteps = stepsOf(jobsOf(trusted)['trusted-range']);
  expect(trustedSteps[0].with).toMatchObject({
    ref: '${{ github.event.pull_request.base.sha }}',
  });
  expect(trustedSteps[2].env).toMatchObject({
    HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
  });
  expect(
    trustedSteps.filter((step) => typeof step.run === 'string').map((step) => step.run),
  ).toEqual([
    'node scripts/ci.mjs --fetch',
    'node scripts/ci.mjs --range "$BASE_SHA" "$HEAD_SHA" "$CURRENT_BASE_SHA"',
  ]);
  for (const job of Object.values({
    ...jobs,
    ...jobsOf(readWorkflow(join(project, '.github/workflows/trusted-scan.yml'))),
  })) {
    for (const step of stepsOf(job)) {
      if (isRecord(step.with)) {
        for (const key of ['node-version-file', 'cache-dependency-path']) {
          if (typeof step.with[key] === 'string')
            expect(existsSync(join(project, step.with[key]))).toBe(true);
        }
      }
      if (typeof step.run === 'string')
        expect(existsSync(join(project, step.run.split(' ')[1]))).toBe(true);
    }
  }
  const config = readPackage(join(project, 'scripts/ci/gates.json'));
  if (!Array.isArray(config.gates)) throw new Error('Gate list missing');
  const gates = config.gates.map((gate: unknown) => {
    if (!isRecord(gate) || !Array.isArray(gate.args)) throw new Error('Gate malformed');
    return gate;
  });
  expect(gates.map((gate) => gate.name)).toEqual([
    'Full-tree hard bans',
    'Package-manager inventory',
    'Workspace dependency check',
    'Colour contrast',
    'Lint',
    'Typecheck',
    'Unit and config tests',
    'Build',
    'Backend end-to-end',
  ]);
  expect(config.install).toEqual({
    name: 'Install dependencies',
    command: 'pnpm',
    args: ['install', '--frozen-lockfile'],
    env: { MONGOMS_DISABLE_POSTINSTALL: '1' },
  });
  const root = readPackage(join(project, 'package.json'));
  expect(root.workspaces).toEqual(['backend', 'frontend', 'shared/core', 'shared/sdk']);
  expect(root.packageManager).toBe('pnpm@12.6.0');
  for (const file of [
    'package.json',
    'backend/package.json',
    'frontend/package.json',
    'shared/core/package.json',
    'shared/sdk/package.json',
  ]) {
    expect(readPackage(join(project, file)).engines, file).toEqual({
      node: '^22.12.0 || ^24.22.0',
      pnpm: '12.6.0',
    });
  }
  const files = await listFiles(project);
  for (const workspace of root.workspaces as string[]) {
    expect(files.some((file) => matchesGlob(file, `${workspace}/package.json`))).toBe(true);
  }
  if (!isRecord(root.scripts)) throw new Error('Root scripts missing');
  for (const command of Object.values(root.scripts)) {
    if (typeof command !== 'string') continue;
    for (const match of command.matchAll(/\b(scripts\/[^\s'"]+)/g)) {
      expect(
        files.some((file) => matchesGlob(file, match[1])),
        match[1],
      ).toBe(true);
    }
  }
  expect(isRecord(root.scripts) && root.scripts.ci).toBe('node scripts/ci.mjs');
  for (const gate of gates) {
    const args = gate.args as string[];
    if (gate.command === 'node') {
      expect(existsSync(join(project, args[0]))).toBe(true);
      continue;
    }
    const filterIndex = args.indexOf('--filter');
    const target = filterIndex < 0 ? project : join(project, args[filterIndex + 1]);
    const pkg = readPackage(join(target, 'package.json'));
    const runIndex = args.indexOf('run');
    const script = runIndex < 0 ? args[0] : args[runIndex + 1];
    expect(isRecord(pkg.scripts) && typeof pkg.scripts[script]).toBe('string');
  }
  const output = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { selectGates } from './scripts/ci/runner.mjs'; import { readFileSync } from 'node:fs'; const config = JSON.parse(readFileSync('scripts/ci/gates.json')); console.log([selectGates(config, '--quality').length, selectGates(config, '--api').length, config.groups.join()].join(' '));",
    ],
    { cwd: project, encoding: 'utf8' },
  );
  expect({ status: output.status, output: output.stdout.trim() }).toEqual({
    status: 0,
    output: '8 1 quality,api',
  });
  const missingGroup = spawnSync(process.execPath, ['scripts/ci.mjs', '--installer'], {
    cwd: project,
    encoding: 'utf8',
  });
  expect(missingGroup.status).toBe(2);
  const ciDocs = readFileSync(join(project, 'docs/reference/code-quality.md'), 'utf8')
    .split('## Continuous integration')[1]
    .split('## Hard-ban scan')[0];
  expect(ciDocs).not.toMatch(/installer/i);
  expect(readFileSync(join(project, 'docs/reference/code-quality.md'), 'utf8')).not.toMatch(
    /test:config:all|--installer|Installer combinations|repository-only/,
  );
  expect(readFileSync(join(project, '.github/workflows/ci.yml'), 'utf8')).not.toMatch(
    /installer|packages\//,
  );
  expect(readFileSync(join(project, 'scripts/ci/gates.json'), 'utf8')).not.toMatch(
    /create-authstack-starter|test:config:all|repositoryOnly/,
  );
}
