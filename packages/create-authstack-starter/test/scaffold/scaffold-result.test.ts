import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const TEMPLATE_FIXTURE = vi.hoisted(() => ({ path: '', lockfile: '' }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { writeAnswersTemplate } = await import('../support/answers-fixture.js');
  const { templateDir } = await import('../../src/paths.js');
  return {
    ...actual,
    lstat: async (path: Parameters<typeof actual.lstat>[0]) =>
      actual.lstat(path === templateDir() ? TEMPLATE_FIXTURE.path : path),
    cp: async (_source: string, target: string): Promise<void> => {
      writeAnswersTemplate(target);
      for (const path of [
        'README.md',
        'docs/README.md',
        'docs/setup/setup-smtp.md',
        '.husky/pre-commit',
        '.husky/commit-msg',
        '.husky/pre-push',
      ]) {
        mkdirSync(dirname(join(target, path)), { recursive: true });
        writeFileSync(join(target, path), path.endsWith('.md') ? '# Fixture\n' : '#!/bin/sh\n');
      }
      if (TEMPLATE_FIXTURE.lockfile !== '') {
        writeFileSync(join(target, 'pnpm-lock.yaml'), TEMPLATE_FIXTURE.lockfile);
      }
    },
  };
});

import { ANSWERS_FILE_NAME } from '../../src/constants/index.js';
import { loadManifest } from '../../src/manifest/load.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { parseCliOptions } from '../../src/flags/options.js';
import { answersRecord, readAnswersRecord } from '../../src/scaffold/answers.js';
import { scaffoldProject } from '../../src/scaffold/project.js';
import { fixtureRoot, isolatedGit, TEMPLATE_SHA } from '../support/answers-helpers.js';
import { writePnpmBoundary } from '../support/pnpm-boundary.js';

const roots: string[] = [];

beforeEach(async () => {
  TEMPLATE_FIXTURE.path = fixtureRoot(roots);
  TEMPLATE_FIXTURE.lockfile = '';
  const bin = join(TEMPLATE_FIXTURE.path, 'bin');
  mkdirSync(bin);
  await writePnpmBoundary(bin, '', '12.6.0', true);
  const { overrides } = isolatedGit(TEMPLATE_FIXTURE.path);
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  vi.stubEnv('PATH', [bin, process.env.PATH ?? ''].join(delimiter));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(['strict', 'standard'] as const)(
  'returns the completed %s scaffold as data with its recorded rules',
  async (rules) => {
    const target = join(TEMPLATE_FIXTURE.path, 'app');
    const manifest = await loadManifest(TEMPLATE_FIXTURE.path);
    const options = parseCliOptions([target, '--yes', '--no-git', '--no-install']);
    const plan = resolvePlan(manifest, {
      features: ['email-password'],
      rules,
      options: { docker: true },
    });
    const result = await scaffoldProject(
      target,
      manifest,
      plan,
      options,
      answersRecord(
        { name: 'create-authstack-starter', version: '0.1.0' },
        { sha256: TEMPLATE_SHA, commit: null },
        plan,
      ),
    );

    expect(result?.files).toEqual({ count: 22, instructions: ['AGENTS.md', 'CLAUDE.md'] });
    expect({ summary: result?.rules, recorded: (await readAnswersRecord(target)).rules }).toEqual({
      summary: rules,
      recorded: { policy: rules },
    });
    expect({
      lockfile: result?.lockfile,
      git: result?.git,
      install: result?.install,
      hooks: result?.hooks,
      exitCode: result?.exitCode,
      nextSteps: result?.nextSteps,
    }).toEqual({
      lockfile: { status: 'updated' },
      git: { status: 'not-requested' },
      install: { status: 'not-requested' },
      hooks: { included: true, active: false, activationCommand: 'git init && pnpm install' },
      exitCode: 0,
      nextSteps: [
        `cd ${target}`,
        'pnpm install',
        'cp .env.docker.example .env.docker',
        'docker compose --env-file .env.docker up -d',
      ],
    });
  },
);

it('stops when a database rule finds nothing to change and nothing was left out', async () => {
  const target = join(TEMPLATE_FIXTURE.path, 'app');
  const real = await loadManifest(TEMPLATE_FIXTURE.path);
  // The stand-in template holds no mobile app. The other clients stay known
  // by name and own nothing, so leaving them out takes nothing away.
  const manifest = {
    ...real,
    targets: Object.fromEntries(
      Object.entries(real.targets).map(([id, client]) => [
        id,
        id === 'web' ? client : { ...client, files: [], envFiles: [] },
      ]),
    ),
    shared: Object.fromEntries(
      Object.entries(real.shared).map(([id, shared]) => [id, { ...shared, files: [] }]),
    ),
  };
  const options = parseCliOptions([target, '--yes', '--no-git', '--no-install']);
  // It also holds none of what the real manifest's database rules name.
  const plan = resolvePlan(manifest, { preset: 'everything', targets: ['web'] });
  const written = vi.mocked(process.stdout.write);

  const result = await scaffoldProject(
    target,
    manifest,
    plan,
    options,
    answersRecord(
      { name: 'create-authstack-starter', version: '0.1.0' },
      { sha256: TEMPLATE_SHA, commit: null },
      plan,
    ),
  );
  const printed = written.mock.calls.map(([chunk]) => String(chunk)).join('');

  expect({
    planErrors: plan.errors,
    result,
    namesTheRule: printed.includes('package "pg" is in no package manifest'),
    recorded: existsSync(join(target, ANSWERS_FILE_NAME)),
  }).toEqual({ planErrors: [], result: undefined, namesTheRule: true, recorded: false });
});

it.each(['strict', 'standard'] as const)(
  'reports a surviving stale database rewrite in a partial %s project',
  async (rules) => {
    const target = join(TEMPLATE_FIXTURE.path, 'app');
    const real = await loadManifest(TEMPLATE_FIXTURE.path);
    const plan = resolvePlan(real, { features: ['email-password'], rules });
    const chosen = real.databases[plan.database];
    const manifest = {
      ...real,
      databases: {
        ...real.databases,
        [plan.database]: {
          ...chosen,
          rewrites: [
            ...chosen.rewrites,
            { files: ['docs/README.md'], from: 'stale text', to: 'new text' },
          ],
        },
      },
    };
    const options = parseCliOptions([target, '--yes', '--no-git', '--no-install']);
    const written = vi.mocked(process.stdout.write);

    const result = await scaffoldProject(
      target,
      manifest,
      plan,
      options,
      answersRecord(
        { name: 'create-authstack-starter', version: '0.1.0' },
        { sha256: TEMPLATE_SHA, commit: null },
        plan,
      ),
    );
    const printed = written.mock.calls.map(([chunk]) => String(chunk)).join('');

    expect({
      succeeded: result?.exitCode === 0,
      namesRule: printed.includes('stale text'),
      targetRetained: existsSync(join(target, 'docs/README.md')),
      recorded: existsSync(join(target, ANSWERS_FILE_NAME)),
    }).toEqual({ succeeded: true, namesRule: true, targetRetained: true, recorded: true });
  },
);

// Catches a failed lockfile update that deletes the lockfile or lets generation report success.
it('stops and keeps the copied lockfile when the lockfile update fails', async () => {
  TEMPLATE_FIXTURE.lockfile = 'lockfileVersion: fixture\n';
  const failing = join(TEMPLATE_FIXTURE.path, 'failing-bin');
  mkdirSync(failing);
  await writePnpmBoundary(failing, '--lockfile-only');
  vi.stubEnv('PATH', [failing, process.env.PATH ?? ''].join(delimiter));
  const target = join(TEMPLATE_FIXTURE.path, 'app');
  const manifest = await loadManifest(TEMPLATE_FIXTURE.path);
  const plan = resolvePlan(manifest, { features: ['email-password'] });

  const result = await scaffoldProject(
    target,
    manifest,
    plan,
    parseCliOptions([target, '--yes', '--no-git', '--no-install']),
    answersRecord(
      { name: 'create-authstack-starter', version: '0.1.0' },
      { sha256: TEMPLATE_SHA, commit: null },
      plan,
    ),
  );

  expect({
    result,
    lockfile: readFileSync(join(target, 'pnpm-lock.yaml'), 'utf8'),
    recorded: existsSync(join(target, ANSWERS_FILE_NAME)),
  }).toEqual({ result: undefined, lockfile: 'lockfileVersion: fixture\n', recorded: false });
});

// Catches a wrong pnpm that withholds the generated files or keeps a lockfile it never updated.
it('finishes without the lockfile and records the answers under a wrong pnpm', async () => {
  TEMPLATE_FIXTURE.lockfile = 'lockfileVersion: fixture\n';
  const wrong = join(TEMPLATE_FIXTURE.path, 'wrong-bin');
  mkdirSync(wrong);
  await writePnpmBoundary(wrong, '', '10.0.0');
  vi.stubEnv('PATH', [wrong, process.env.PATH ?? ''].join(delimiter));
  const target = join(TEMPLATE_FIXTURE.path, 'app');
  const manifest = await loadManifest(TEMPLATE_FIXTURE.path);
  const plan = resolvePlan(manifest, { features: ['email-password'] });

  const result = await scaffoldProject(
    target,
    manifest,
    plan,
    parseCliOptions([target, '--yes', '--no-git', '--no-install']),
    answersRecord(
      { name: 'create-authstack-starter', version: '0.1.0' },
      { sha256: TEMPLATE_SHA, commit: null },
      plan,
    ),
  );

  expect({
    lockfile: result?.lockfile.status,
    exitCode: result?.exitCode,
    lockfilePresent: existsSync(join(target, 'pnpm-lock.yaml')),
    recorded: existsSync(join(target, ANSWERS_FILE_NAME)),
  }).toEqual({ lockfile: 'removed', exitCode: 1, lockfilePresent: false, recorded: true });
});
