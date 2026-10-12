import { spawnSync } from 'node:child_process';
import { mkdir, readFile, symlink } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { applyRules, planRules, renderRulesPlan } from '../../src/add-rules/plan.js';
import {
  ADD_RULES_DEPENDENCIES,
  ADD_RULES_HUSKY_ENTRY,
  RULES_SCANNER_ENTRY,
} from '../../src/constants/rules.js';
import {
  cleanRulesFixtures,
  fixtureEnvironment,
  put,
  rulesFixture,
  TRUSTED_RULES_ROOT,
} from './add-rules-fixture.js';

afterEach(cleanRulesFixtures);

const POLICY_POINTER =
  'The folders and individual files are listed in `CAPPED_PATH` and `CAPPED_FILES` in `scripts/guardrails/policy.mjs`.';
const BUNDLED_CEILING = 'The bundled guardrail files are also covered.';
const NO_MATCH = `None of this project's source folders match the ceiling's folder pattern. ${BUNDLED_CEILING} ${POLICY_POINTER} Edit the folder pattern to cover your source folders.`;

/** How many whole lines of a text are exactly the given line. */
function linesEqualTo(text: string, line: string): number {
  return text.split('\n').filter((candidate) => candidate === line).length;
}

/** A project laid out unlike the template: its code is under apps/. */
async function foreignProject(extra: Record<string, string> = {}): Promise<string> {
  const root = await rulesFixture({
    packageManager: 'pnpm@12.6.0',
    workspaces: ['apps/*'],
    scripts: { lint: 'echo ok' },
  });
  const files = {
    'apps/web/package.json': '{}',
    'apps/web/src/page.ts': 'export {};\n',
    'apps/api/package.json': '{}',
    'apps/api/src/main.ts': 'export {};\n',
    ...extra,
  };
  for (const [path, content] of Object.entries(files)) await put(root, path, content);
  return root;
}

async function commitlintStatus(root: string, message: string): Promise<number | null> {
  return spawnSync(
    process.execPath,
    ['node_modules/@commitlint/cli/cli.js', '--config', 'commitlint.config.cjs'],
    { cwd: root, env: fixtureEnvironment(root), input: `${message}\n`, encoding: 'utf8' },
  ).status;
}

it('writes a commit check that accepts scopes named after the project folders', async () => {
  const root = await foreignProject();
  await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT));
  await mkdir(join(root, 'node_modules'));
  await symlink(
    join(TRUSTED_RULES_ROOT, 'node_modules/@commitlint'),
    join(root, 'node_modules/@commitlint'),
  );

  expect({
    projectScope: await commitlintStatus(root, 'feat(api): add route'),
    noScope: await commitlintStatus(root, 'fix: correct the total'),
    unknownType: await commitlintStatus(root, 'nope(api): add route'),
    noType: await commitlintStatus(root, 'invalid message'),
    longSubject: await commitlintStatus(root, `feat(api): ${'a'.repeat(101)}`),
  }).toEqual({ projectScope: 0, noScope: 0, unknownType: 1, noType: 1, longSubject: 1 });
});

it.each(['strict', 'standard'] as const)(
  'says at %s that any commit scope is accepted',
  async (level) => {
    const plan = await planRules(await foreignProject(), level, TRUSTED_RULES_ROOT);
    const agents = plan.files.find(({ path }) => path === 'AGENTS.md')?.content ?? '';

    expect(agents.split('\n').filter((line) => line.startsWith('- Scopes:'))).toEqual([
      '- Scopes: any. The commit check does not restrict scopes.',
    ]);
  },
);

it('names the project folders the file length ceiling covers', async () => {
  const root = await foreignProject({
    'backend/src/main.ts': 'export {};\n',
    'backend/src/users/users.ts': 'export {};\n',
    'shared/node_modules/src/index.ts': 'export {};\n',
    'frontend/src/app.tsx': 'export {};\n',
  });
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  const agents = plan.files.find(({ path }) => path === 'AGENTS.md')?.content ?? '';
  const scope = `The file length ceiling applies to these project folders: \`backend/src\`, \`frontend/src\`. ${BUNDLED_CEILING} ${POLICY_POINTER}`;

  expect({
    folders: plan.ceilingFolders,
    agents: linesEqualTo(agents, `${scope} Split long files to stay within it.`),
    planLine: linesEqualTo(renderRulesPlan(plan), scope),
  }).toEqual({ folders: ['backend/src', 'frontend/src'], agents: 1, planLine: 1 });
});

it('reports the same folders the shipped checker caps', async () => {
  const root = await foreignProject({ 'backend/src/main.ts': 'export {};\n' });
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  const checker: unknown = await import(
    pathToFileURL(join(TRUSTED_RULES_ROOT, RULES_SCANNER_ENTRY)).href
  );
  if (typeof checker !== 'object' || checker === null || !('isCappedPath' in checker))
    throw new Error('The shipped checker has no isCappedPath export.');
  const { isCappedPath } = checker;
  if (typeof isCappedPath !== 'function') throw new Error('isCappedPath is not a function.');

  expect({
    folders: plan.ceilingFolders,
    capped: [isCappedPath('backend/src/main.ts'), isCappedPath('apps/api/src/main.ts')],
    bundled: ['scripts/guardrails/policy.mjs', 'scripts/check-hard-bans.mjs'].map(
      (path) => plan.files.some((file) => file.path === path) && isCappedPath(path),
    ),
  }).toEqual({ folders: ['backend/src'], capped: [true, false], bundled: [true, true] });
});

it('says plainly when no project folder is under the file length ceiling', async () => {
  const plan = await planRules(await foreignProject(), 'strict', TRUSTED_RULES_ROOT);
  const agents = plan.files.find(({ path }) => path === 'AGENTS.md')?.content ?? '';

  // The plan prints AGENTS.md in full and then states the scope once more on its own line.
  expect({
    folders: plan.ceilingFolders,
    agents: linesEqualTo(agents, NO_MATCH),
    planLines: linesEqualTo(renderRulesPlan(plan), NO_MATCH),
  }).toEqual({ folders: [], agents: 1, planLines: 2 });
});

it('does not describe a ceiling at standard, where the scan is off', async () => {
  const root = await foreignProject({ 'backend/src/main.ts': 'export {};\n' });
  const plan = await planRules(root, 'standard', TRUSTED_RULES_ROOT);
  const statements = renderRulesPlan(plan)
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('The file length ceiling applies') ||
        line.startsWith("None of this project's source folders match"),
    );

  expect({ folders: plan.ceilingFolders, statements }).toEqual({
    folders: undefined,
    statements: [],
  });
});

/** Packages a written file loads: module specifiers, extended configs, node_modules paths. */
function loadedPackages(content: string): string[] {
  const specifiers = [
    ...content.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|\)\s*\(\s*)['"]([^'"]+)['"]/g),
    ...content.matchAll(/extends:\s*\[\s*['"]([^'"]+)['"]/g),
    ...content.matchAll(/node_modules\/((?:@[^/\s'"]+\/)?[^/\s'"]+)\//g),
  ].map((match) => match[1]);
  return specifiers
    .filter((name) => !name.startsWith('.') && !name.startsWith('node:'))
    .filter((name) => !builtinModules.includes(name))
    .map((name) =>
      name
        .split('/')
        .slice(0, name.startsWith('@') ? 2 : 1)
        .join('/'),
    );
}

it.each(['strict', 'standard'] as const)(
  'asks at %s for exactly the packages its written files load',
  async (level) => {
    const root = await foreignProject();
    const result = await applyRules(await planRules(root, level, TRUSTED_RULES_ROOT));
    const loaded = new Set(loadedPackages(ADD_RULES_HUSKY_ENTRY));
    for (const path of result.files.paths ?? []) {
      if (path.endsWith('.md') || path.endsWith('.yml')) continue;
      for (const name of loadedPackages(await readFile(join(root, path), 'utf8'))) loaded.add(name);
    }

    expect([...loaded].sort()).toEqual([
      '@commitlint/cli',
      '@commitlint/config-conventional',
      'husky',
      'lint-staged',
      'prettier',
    ]);
    expect(ADD_RULES_DEPENDENCIES.map((entry) => entry.slice(0, entry.lastIndexOf('@')))).toEqual([
      'husky',
      'lint-staged',
      'prettier',
      '@commitlint/cli',
      '@commitlint/config-conventional',
    ]);
  },
);
