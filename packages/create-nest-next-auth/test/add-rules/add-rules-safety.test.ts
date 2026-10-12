import { chmod, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { applyRules, planRules } from '../../src/add-rules/plan.js';
import { checkPath } from '../../src/add-rules/paths.js';
import {
  cleanRulesFixtures,
  fixtureGit,
  put,
  rulesFixture,
  TRUSTED_RULES_ROOT,
  trackedRulesFile,
} from './add-rules-fixture.js';

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanRulesFixtures();
});
it.each([
  '.husky',
  '.lintstagedrc',
  '.lintstagedrc.json',
  '.lintstagedrc.yaml',
  '.lintstagedrc.yml',
  '.lintstagedrc.js',
  '.lintstagedrc.cjs',
  '.lintstagedrc.mjs',
  '.lintstagedrc.ts',
  '.lintstagedrc.cts',
  '.lintstagedrc.mts',
  'package.yaml',
  'package.yml',
  'lint-staged.config.js',
  'lint-staged.config.cjs',
  'lint-staged.config.mjs',
  'lint-staged.config.ts',
  'lint-staged.config.cts',
  'lint-staged.config.mts',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yaml',
  '.commitlintrc.yml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  '.commitlintrc.mjs',
  '.commitlintrc.ts',
  '.commitlintrc.cts',
  '.commitlintrc.mts',
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  'commitlint.config.ts',
  'commitlint.config.cts',
  'commitlint.config.mts',
])('detects existing %s and applies nothing', async (path) => {
  const root = await rulesFixture();
  if (path === '.husky') await mkdir(join(root, path));
  else await put(root, path, 'throw new Error("MUST NOT IMPORT");\n');
  const before = await readdir(root);
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  await expect(applyRules(plan)).rejects.toThrow('Nothing written');
  expect({ blockers: plan.blockers, tree: await readdir(root) }).toEqual({
    blockers: [
      `Existing setup: ${path}`,
      ...(path === 'commitlint.config.cjs' || path === '.lintstagedrc.cjs'
        ? [`Existing file: ${path}`]
        : []),
    ],
    tree: before,
  });
});
it.each(['prepare', 'lint-staged', 'commitlint'] as const)(
  'detects %s in package.json without executing',
  async (key) => {
    const root = await rulesFixture({
      packageManager: 'pnpm@12.6.0',
      ...(key === 'prepare'
        ? { scripts: { prepare: "node -e \"require('fs').writeFileSync('marker','ran')\"" } }
        : { [key]: {} }),
    });
    const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
    await expect(applyRules(plan)).rejects.toThrow('Nothing written');
    expect(await readdir(root)).toEqual(['package.json']);
  },
);
it.each([
  'AGENTS.md',
  'CLAUDE.md',
  '.github/workflows/ci.yml',
  '.github/workflows/trusted-scan.yml',
])('preserves existing %s', async (path) => {
  const root = await rulesFixture();
  await put(root, path, 'owned\n');
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  await expect(applyRules(plan)).rejects.toThrow('Nothing written');
  expect(await readFile(join(root, path), 'utf8')).toBe('owned\n');
});
it('requires an explicit alternate agent file and preserves existing instructions', async () => {
  const root = await rulesFixture();
  await put(root, 'AGENTS.md', 'owned\n');
  await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT, 'AGENTS.rules.md'));
  expect({
    agents: await readFile(join(root, 'AGENTS.md'), 'utf8'),
    claude: await readFile(join(root, 'CLAUDE.md'), 'utf8'),
    replay: (await planRules(root, 'strict', TRUSTED_RULES_ROOT)).files,
  }).toEqual({ agents: 'owned\n', claude: 'See AGENTS.rules.md for project rules.\n', replay: [] });
});
it('refuses a file appearing after the plan and writes no other file', async () => {
  const root = await rulesFixture();
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  await put(root, 'CLAUDE.md', 'racing writer\n');
  await expect(applyRules(plan)).rejects.toThrow('Project changed after inspection');
  expect(await readdir(root)).toEqual(['CLAUDE.md', 'package.json']);
});
it('refuses a setup or manifest change between inspection and confirmation', async () => {
  const root = await rulesFixture();
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  await put(root, 'lint-staged.config.ts', 'export default {};');
  await expect(applyRules(plan)).rejects.toThrow('Project setup changed');
  expect(await readdir(root)).toEqual(['lint-staged.config.ts', 'package.json']);
});
it.each(['/tmp/outside', '../outside', 'x/../../outside'])(
  'refuses write path %s',
  async (path) => {
    const root = await rulesFixture();
    await expect(checkPath(root, path)).rejects.toThrow('Unsafe project path');
  },
);
it('disables file monitor and hooks and removes inherited repository variables with real Git', async () => {
  const root = await rulesFixture();
  const other = await rulesFixture();
  fixtureGit(root, ['init', '--quiet']);
  fixtureGit(other, ['init', '--quiet']);
  await put(root, 'monitor.sh', '#!/bin/sh\nprintf ran > marker\n');
  await chmod(join(root, 'monitor.sh'), 0o755);
  fixtureGit(root, ['config', 'core.fsmonitor', join(root, 'monitor.sh')]);
  fixtureGit(root, ['config', 'core.hooksPath', 'custom-hooks']);
  await put(root, 'custom-hooks/post-index-change', '#!/bin/sh\nprintf ran > hook-marker\n');
  await chmod(join(root, 'custom-hooks/post-index-change'), 0o755);
  vi.stubEnv('GIT_DIR', join(other, '.git'));
  vi.stubEnv('GIT_WORK_TREE', other);
  vi.stubEnv('GIT_INDEX_FILE', join(other, '.git/index'));
  const configBefore = await readFile(join(root, '.git/config'), 'utf8');
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  expect({
    blockers: plan.blockers,
    files: await readdir(root),
    config: await readFile(join(root, '.git/config'), 'utf8'),
  }).toEqual({
    blockers: ['Existing core.hooksPath. Integrate hooks manually.'],
    files: ['.git', 'custom-hooks', 'monitor.sh', 'package.json'],
    config: configBefore,
  });
});
it('never executes malicious project and script names', async () => {
  const root = await rulesFixture({
    name: '$(touch marker); bad',
    packageManager: 'npm@10.9.9',
    scripts: { 'lint; touch marker': 'touch marker', lint: 'touch marker' },
  });
  await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT));
  expect((await readdir(root)).includes('marker')).toBe(false);
});
it('refuses hooks path changed while confirming the plan', async () => {
  const root = await rulesFixture();
  fixtureGit(root, ['init', '--quiet']);
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  fixtureGit(root, ['config', 'core.hooksPath', 'existing-hooks']);
  await expect(applyRules(plan)).rejects.toThrow('Git hooks path changed after inspection');
  expect(await readdir(root)).toEqual(['.git', 'package.json']);
});

it('never runs a configured Git clean filter while inspecting a tracked project', async () => {
  const root = await rulesFixture();
  fixtureGit(root, ['init', '--quiet']);
  await trackedRulesFile(root);
  await put(root, '.gitattributes', 'tracked.txt filter=project\n');
  await put(root, 'clean-filter.sh', '#!/bin/sh\nprintf ran > filter-marker\ncat\n');
  await chmod(join(root, 'clean-filter.sh'), 0o755);
  fixtureGit(root, ['config', 'filter.project.clean', './clean-filter.sh']);
  await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT));
  expect((await readdir(root)).includes('filter-marker')).toBe(false);
});

it('never calls a project dependency named Git from the inherited executable search path', async () => {
  const root = await rulesFixture();
  fixtureGit(root, ['init', '--quiet']);
  await put(root, 'node_modules/.bin/git', '#!/bin/sh\nprintf ran > binary-marker\nexit 0\n');
  await chmod(join(root, 'node_modules/.bin/git'), 0o755);
  vi.stubEnv('PATH', `${join(root, 'node_modules/.bin')}:${process.env.PATH ?? ''}`);
  await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  expect((await readdir(root)).includes('binary-marker')).toBe(false);
});

it('preserves an explicitly empty hooks path instead of treating it as absent', async () => {
  const root = await rulesFixture();
  fixtureGit(root, ['init', '--quiet']);
  fixtureGit(root, ['config', 'core.hooksPath', '']);
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  await expect(applyRules(plan)).rejects.toThrow('Existing core.hooksPath');
  expect(await readdir(root)).toEqual(['.git', 'package.json']);
});
