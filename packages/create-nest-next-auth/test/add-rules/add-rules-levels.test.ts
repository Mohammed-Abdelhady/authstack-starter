import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { applyRules, planRules, renderRulesPlan } from '../../src/add-rules/plan.js';
import { parseAddRulesOptions } from '../../src/flags/add-rules.js';
import { cleanRulesFixtures, put, rulesFixture, TRUSTED_RULES_ROOT } from './add-rules-fixture.js';

afterEach(cleanRulesFixtures);
it.each(['strict', 'standard'] as const)(
  'renders %s with level-specific hooks and workflows and honest summary',
  async (level) => {
    const root = await rulesFixture();
    const plan = await planRules(root, level, TRUSTED_RULES_ROOT);
    const display = renderRulesPlan(plan);
    expect({
      unchanged: await readdir(root),
      allContentsDisplayed: plan.files.every(({ path, content }) =>
        display.includes(`--- ${path} ---\n${content}`),
      ),
      active: plan.summary.hooks.active,
      checks: plan.summary.checksRun,
      install: plan.summary.install.status,
      activation: plan.summary.hooks.activationCommand,
    }).toEqual({
      unchanged: ['package.json'],
      allContentsDisplayed: true,
      active: false,
      checks: [],
      install: 'not-requested',
      activation: 'git init && node node_modules/husky/bin.js',
    });
    const result = await applyRules(plan);
    const precommit = await readFile(join(root, '.husky/pre-commit'), 'utf8');
    const push = await readFile(join(root, '.husky/pre-push'), 'utf8');
    const commit = await readFile(join(root, '.husky/commit-msg'), 'utf8');
    const workflow = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
    expect({
      countMatches:
        result.files.count ===
        (await readdir(root, { recursive: true, withFileTypes: true })).filter(
          (entry) => entry.isFile() && entry.name !== 'package.json',
        ).length,
      scan: precommit.includes('--staged'),
      pushScan: push.includes('--push'),
      commitFormat: commit.includes('node_modules/@commitlint/cli/cli.js'),
      strip: commit.includes('--commit-msg'),
      range: workflow.includes('range-scan:'),
      trusted: (await readdir(join(root, '.github/workflows'))).includes('trusted-scan.yml'),
      lf: plan.files.every(({ content }) => !content.includes('\r')),
    }).toEqual({
      countMatches: true,
      scan: level === 'strict',
      pushScan: level === 'strict',
      commitFormat: true,
      strip: true,
      range: level === 'strict',
      trusted: level === 'strict',
      lf: true,
    });
    const replay = await planRules(root, level, TRUSTED_RULES_ROOT);
    expect({ files: replay.files, blockers: replay.blockers }).toEqual({ files: [], blockers: [] });
    const other = await planRules(
      root,
      level === 'strict' ? 'standard' : 'strict',
      TRUSTED_RULES_ROOT,
    );
    expect(other.blockers).toEqual(['Changing rules level is not supported.']);
  },
);
it('reports every missing gate and never invents scripts', async () => {
  const root = await rulesFixture({ packageManager: 'npm@10.9.9' });
  const plan = await planRules(root, 'standard', TRUSTED_RULES_ROOT);
  await applyRules(plan);
  const gates: unknown = JSON.parse(await readFile(join(root, 'scripts/ci/gates.json'), 'utf8'));
  expect(gates).toEqual({
    install: {
      name: 'Install dependencies',
      command: 'npm',
      args: ['install', '--ignore-scripts'],
    },
    gates: [],
    environment: {},
  });
  expect(plan.summary.skipped.slice(0, 4)).toEqual([
    { check: 'lint', reason: 'not added: package.json has no lint script' },
    { check: 'typecheck', reason: 'not added: package.json has no typecheck script' },
    { check: 'tests', reason: 'not added: package.json has no test script' },
    { check: 'build', reason: 'not added: package.json has no build script' },
  ]);
});
it.each(['edited', 'missing'] as const)(
  'refuses %s partial setup without repairing it silently',
  async (kind) => {
    const root = await rulesFixture();
    await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT));
    if (kind === 'edited') await put(root, 'CLAUDE.md', 'owned');
    else await rm(join(root, 'CLAUDE.md'));
    const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
    await expect(applyRules(plan)).rejects.toThrow('Nothing written');
  },
);
it('parses only the existing-project flags, defaults to strict and rejects unknown flags', () => {
  expect(
    parseAddRulesOptions(
      ['--rules', 'standard', '--dry-run', '--yes', '--agents-file', 'AGENTS.rules.md'],
      '1.0.0',
    ),
  ).toEqual({ rules: 'standard', dryRun: true, yes: true, agentsFile: 'AGENTS.rules.md' });
  expect(parseAddRulesOptions([], '1.0.0')).toEqual({ rules: 'strict', dryRun: false, yes: false });
  expect(() => parseAddRulesOptions(['--config', 'untrusted.js'], '1.0.0')).toThrow();
});
it.each(['omitted', 'unsafe'] as const)(
  'refuses an %s receipt entry without trusting its paths',
  async (kind) => {
    const root = await rulesFixture();
    await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT));
    const receipt: unknown = JSON.parse(
      await readFile(join(root, '.create-nest-next-auth.rules.json'), 'utf8'),
    );
    if (
      typeof receipt !== 'object' ||
      receipt === null ||
      !('files' in receipt) ||
      !Array.isArray(receipt.files)
    )
      throw new Error('Invalid fixture receipt');
    if (kind === 'omitted') receipt.files.pop();
    else receipt.files.push({ path: '../outside', hash: 'abc' });
    await put(root, '.create-nest-next-auth.rules.json', JSON.stringify(receipt));
    if (kind === 'unsafe')
      await expect(planRules(root, 'strict', TRUSTED_RULES_ROOT)).rejects.toThrow(
        'Unsafe or unknown path',
      );
    else
      await expect(applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT))).rejects.toThrow(
        'Partial existing rules setup',
      );
  },
);
it.each([null, '', '   ', 12])('does not add an unusable root script %s', async (script) => {
  const root = await rulesFixture({ packageManager: 'pnpm@12.6.0', scripts: { lint: script } });
  const plan = await planRules(root, 'standard', TRUSTED_RULES_ROOT);
  await applyRules(plan);
  expect({
    missingGates: plan.summary.notAdded?.filter(({ check }) => check === 'Lint'),
    gates: JSON.parse(await readFile(join(root, 'scripts/ci/gates.json'), 'utf8')) as unknown,
    workflowAdded: (await readdir(root)).includes('.github'),
  }).toEqual({
    missingGates: [{ check: 'Lint', reason: 'Required root script is missing: lint' }],
    gates: {
      install: {
        name: 'Install dependencies',
        command: 'pnpm',
        args: ['install', '--frozen-lockfile'],
      },
      gates: [],
      environment: {},
    },
    workflowAdded: false,
  });
});
