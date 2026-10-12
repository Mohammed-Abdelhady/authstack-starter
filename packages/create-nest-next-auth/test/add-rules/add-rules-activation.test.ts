import { spawnSync } from 'node:child_process';
import { chmod, mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { applyRules, planRules } from '../../src/add-rules/plan.js';
import {
  cleanRulesFixtures,
  fixtureEnvironment,
  fixtureGit,
  put,
  rulesFixture,
  TRUSTED_RULES_ROOT,
} from './add-rules-fixture.js';

afterEach(cleanRulesFixtures);
it.each(['active', 'overridden', 'empty', 'missing', 'not-executable', 'directory'] as const)(
  'reports %s hook configuration honestly on replay',
  async (state) => {
    const root = await rulesFixture();
    fixtureGit(root, ['init', '--quiet']);
    await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT));
    for (const name of ['h', 'pre-commit', 'pre-push', 'commit-msg']) {
      await put(root, `.husky/_/${name}`, '#!/bin/sh\nexit 0\n');
      await chmod(join(root, '.husky/_', name), 0o755);
    }
    fixtureGit(root, ['config', '--add', 'core.hooksPath', '.husky/_']);
    if (state === 'empty') fixtureGit(root, ['config', '--add', 'core.hooksPath', '']);
    if (state === 'overridden')
      fixtureGit(root, ['config', '--add', 'core.hooksPath', 'custom-hooks']);
    if (state === 'missing' || state === 'directory') await rm(join(root, '.husky/_/pre-commit'));
    if (state === 'directory') await mkdir(join(root, '.husky/_/pre-commit'));
    if (state === 'not-executable') await chmod(join(root, '.husky/_/pre-commit'), 0o644);
    const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
    expect({
      active: plan.summary.hooks.active,
      activation: plan.summary.hooks.activationCommand,
      files: plan.files,
      blockers: plan.blockers,
    }).toEqual({
      active: state === 'active',
      activation: state === 'active' ? undefined : 'node node_modules/husky/bin.js',
      files: [],
      blockers: [],
    });
  },
);

it('prints an activation command that the installed husky runs', async () => {
  const root = await rulesFixture();
  fixtureGit(root, ['init', '--quiet']);
  const summary = await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT));
  await mkdir(join(root, 'node_modules'));
  await symlink(join(TRUSTED_RULES_ROOT, 'node_modules/husky'), join(root, 'node_modules/husky'));
  const [program, ...args] = (summary.hooks.activationCommand ?? '').split(' ');

  const activated = spawnSync(process.execPath, args, {
    cwd: root,
    env: fixtureEnvironment(root),
    encoding: 'utf8',
  });
  const replay = await planRules(root, 'strict', TRUSTED_RULES_ROOT);

  expect({
    program,
    status: activated.status,
    hooksPath: fixtureGit(root, ['config', '--local', '--get-all', 'core.hooksPath']),
    active: replay.summary.hooks.active,
    activation: replay.summary.hooks.activationCommand,
  }).toEqual({
    program: 'node',
    status: 0,
    hooksPath: '.husky/_\n',
    active: true,
    activation: undefined,
  });
});
