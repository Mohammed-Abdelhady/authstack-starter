import { mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { inspectLayout } from '../../src/add-rules/layout.js';
import { applyRules, planRules } from '../../src/add-rules/plan.js';
import {
  cleanRulesFixtures,
  fixtureGit,
  put,
  rulesFixture,
  TRUSTED_RULES_ROOT,
} from './add-rules-fixture.js';

afterEach(cleanRulesFixtures);
it.each([
  ['pnpm', false, false],
  ['pnpm', true, false],
  ['pnpm', false, true],
  ['npm', false, false],
  ['npm', true, false],
  ['npm', false, true],
] as const)('supports %s package workspaces=%s yaml=%s', async (manager, workspaces, yaml) => {
  const root = await rulesFixture({
    packageManager: `${manager}@12.6.0`,
    ...(workspaces ? { workspaces: ['apps/*'] } : {}),
  });
  if (yaml) await put(root, 'pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
  await put(root, 'apps/web/package.json', '{}');
  const layout = await inspectLayout(root);
  const plan = await planRules(root, 'standard', TRUSTED_RULES_ROOT);
  await applyRules(plan);
  expect({
    manager: layout.manager,
    workspaces: layout.workspaces,
    instructions: plan.summary.files.instructions,
  }).toEqual({
    manager,
    workspaces: workspaces || yaml ? ['apps/web'] : [],
    instructions:
      workspaces || yaml
        ? ['AGENTS.md', 'CLAUDE.md', 'apps/web/AGENTS.md']
        : ['AGENTS.md', 'CLAUDE.md'],
  });
});
it.each(['pnpm', 'npm'] as const)(
  'detects %s by lockfile without a manager field',
  async (manager) => {
    const root = await rulesFixture({});
    await put(root, manager === 'pnpm' ? 'pnpm-lock.yaml' : ['package', 'lock.json'].join('-'), '');
    expect((await inspectLayout(root)).manager).toBe(manager);
  },
);
it.each([
  'no-manifest',
  'no-evidence',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'unknown',
  'nested',
  'conflicting',
] as const)('refuses %s before integration and leaves the tree intact', async (kind) => {
  const root = await rulesFixture(kind === 'unknown' ? { packageManager: 'yarn@1.0.0' } : {});
  if (kind === 'no-manifest' || kind === 'nested') await rm(join(root, 'package.json'));
  if (kind === 'nested') {
    fixtureGit(root, ['init', '--quiet']);
    await mkdir(join(root, 'child'));
  }
  if (kind.includes('.lock')) await put(root, kind, '');
  if (kind === 'conflicting') {
    await put(root, ['package', 'lock.json'].join('-'), '');
    await put(root, 'pnpm-lock.yaml', '');
  }
  const before = await readdir(root);
  await expect(
    planRules(kind === 'nested' ? join(root, 'child') : root, 'strict', TRUSTED_RULES_ROOT),
  ).rejects.toThrow();
  expect(await readdir(root)).toEqual(before);
});
it.each(['/outside', '../outside', 'apps/../../outside'])(
  'refuses unsafe workspace path %s',
  async (path) => {
    const root = await rulesFixture({ packageManager: 'pnpm@12.6.0', workspaces: [path] });
    await expect(inspectLayout(root)).rejects.toThrow('Unsafe project path');
  },
);
it.each(['.husky', 'scripts', 'apps/link', 'AGENTS.md', 'package.json', 'root'])(
  'refuses symlink %s',
  async (path) => {
    const root = await rulesFixture({ packageManager: 'pnpm@12.6.0', workspaces: ['apps/*'] });
    const outside = await rulesFixture();
    if (path === 'package.json') await rm(join(root, path));
    const link = path === 'root' ? join(outside, 'link') : join(root, path);
    await mkdir(join(root, 'apps'), { recursive: true });
    await symlink(path === 'package.json' ? join(outside, 'package.json') : outside, link);
    const before = await readFile(join(outside, 'package.json'), 'utf8');
    await expect(
      planRules(path === 'root' ? link : root, 'strict', TRUSTED_RULES_ROOT),
    ).rejects.toThrow('Symbolic link');
    expect(await readFile(join(outside, 'package.json'), 'utf8')).toBe(before);
  },
);
it.each(['manifest', 'workspace', 'glob', 'nested-root'] as const)(
  'refuses invalid %s layout',
  async (kind) => {
    const root = await rulesFixture();
    if (kind === 'manifest') await put(root, 'package.json', 'null');
    if (kind === 'workspace') await put(root, 'pnpm-workspace.yaml', 'packages: null\n');
    if (kind === 'glob') await put(root, 'pnpm-workspace.yaml', "packages: ['apps/{a,b}']\n");
    if (kind === 'nested-root') {
      fixtureGit(root, ['init', '--quiet']);
      await put(root, 'nested/package.json', '{"packageManager":"pnpm@12.6.0"}');
    }
    await expect(
      planRules(kind === 'nested-root' ? join(root, 'nested') : root, 'strict', TRUSTED_RULES_ROOT),
    ).rejects.toThrow();
  },
);
