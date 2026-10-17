import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repository } from '../test-repository.mjs';
import { workspacePolicyProblems, trackedTypeFiles } from './workspace-policy.mjs';
import { installWorkspaceTools } from './workspace-tool-fixture.mjs';

const RULE = '@typescript-eslint/no-explicit-' + 'a' + 'ny';

function workspace(repo, path, extra = '') {
  repo.write(
    `${path}/package.json`,
    JSON.stringify({
      name: path.replaceAll('/', '-'),
      type: 'module',
      devDependencies: { eslint: '^9.39.5', 'typescript-eslint': '^8.70.1' },
    }),
  );
  installWorkspaceTools(repo.root, path);
  repo.write(
    `${path}/eslint.config.mjs`,
    `
    import tseslint from 'typescript-eslint';
    export default tseslint.config(...tseslint.configs.recommended,
      { linterOptions: { noInlineConfig: true } }, ${extra || '{}'});
  `,
  );
}

function fixture(t, extra = '') {
  const repo = repository(t);
  repo.write('package.json', JSON.stringify({ workspaces: ['apps/*', 'absent'] }));
  workspace(repo, 'apps/one', extra);
  for (const file of [
    'src/a.ts',
    'src/a.spec.ts',
    'test/a.e2e-spec.ts',
    'src/a.harness-spec.ts',
    'src/app/a.ts',
    'src/a.test.tsx',
  ])
    repo.write(`apps/one/${file}`, 'export {};\n');
  repo.commit();
  return repo;
}

for (const [pattern, file] of [
  ['**/*.spec.ts', 'src/a.spec.ts'],
  ['**/*.e2e-spec.ts', 'test/a.e2e-spec.ts'],
  ['**/*.harness-spec.ts', 'src/a.harness-spec.ts'],
  ['test/**', 'test/a.e2e-spec.ts'],
  ['src/app/**', 'src/app/a.ts'],
  ['**/*.test.tsx', 'src/a.test.tsx'],
]) {
  test(`workspace policy catches targeted override: ${pattern}`, async (t) => {
    const repo = fixture(t, `{ files: ['${pattern}'], rules: { '${RULE}': 'off' } }`);
    assert.deepEqual(await workspacePolicyProblems(repo.root, { env: repo.env }), [
      [`apps/one/${file}`, 'type rule'],
    ]);
  });
}

test('workspace policy catches an ignored tracked source file', async (t) => {
  const repo = fixture(t, "{ ignores: ['src/app/**'] }");
  assert.deepEqual(await workspacePolicyProblems(repo.root, { env: repo.env }), [
    ['apps/one/src/app/a.ts', 'ignored'],
  ]);
});

test('workspace policy catches inline configuration permission at one tracked path', async (t) => {
  const repo = fixture(t, "{ files: ['src/app/**'], linterOptions: { noInlineConfig: false } }");
  assert.deepEqual(await workspacePolicyProblems(repo.root, { env: repo.env }), [
    ['apps/one/src/app/a.ts', 'inline config'],
  ]);
});

test('workspace policy catches warning severity at one tracked path', async (t) => {
  const repo = fixture(t, `{ files: ['src/app/**'], rules: { '${RULE}': 'warn' } }`);
  assert.deepEqual(await workspacePolicyProblems(repo.root, { env: repo.env }), [
    ['apps/one/src/app/a.ts', 'type rule'],
  ]);
});

test('workspace policy discovers an additional declared workspace', async (t) => {
  const repo = fixture(t);
  workspace(repo, 'apps/two', `{ rules: { '${RULE}': 'off' } }`);
  repo.write('apps/two/src/b.ts', 'export {};\n');
  repo.commit();
  assert.deepEqual(await workspacePolicyProblems(repo.root, { env: repo.env }), [
    ['apps/two/src/b.ts', 'type rule'],
  ]);
});

test('workspace inventory falls back to files without repository metadata', async (t) => {
  const repo = fixture(t, `{ files: ['src/app/**'], rules: { '${RULE}': 'off' } }`);
  rmSync(join(repo.root, '.git'), { recursive: true });
  assert.deepEqual(await workspacePolicyProblems(repo.root, { env: repo.env }), [
    ['apps/one/src/app/a.ts', 'type rule'],
  ]);
});

test('nested project inventory is relative to the project instead of its parent repository', async (t) => {
  const repo = repository(t);
  repo.write('apps/project/package.json', JSON.stringify({ workspaces: ['packages/*'] }));
  workspace(repo, 'apps/project/packages/one', `{ rules: { '${RULE}': 'off' } }`);
  repo.write('apps/project/packages/one/src/a.ts', 'export {};\n');
  repo.write('outside/src/decoy.ts', 'export {};\n');
  repo.commit();
  assert.deepEqual(
    await workspacePolicyProblems(join(repo.root, 'apps/project'), { env: repo.env }),
    [['packages/one/src/a.ts', 'type rule']],
  );
});

test('a present declared workspace cannot pass without lintable files', async (t) => {
  const repo = fixture(t);
  workspace(repo, 'apps/empty');
  repo.commit();
  assert.deepEqual(await workspacePolicyProblems(repo.root, { env: repo.env }), [
    ['apps/empty', 'no lintable files'],
  ]);
});

test('a second workspace pattern participates in policy resolution', async (t) => {
  const repo = fixture(t);
  repo.write('package.json', JSON.stringify({ workspaces: ['apps/*', 'modules/*'] }));
  workspace(repo, 'modules/two', `{ rules: { '${RULE}': 'off' } }`);
  repo.write('modules/two/src/b.ts', 'export {};\n');
  repo.commit();
  assert.deepEqual(await workspacePolicyProblems(repo.root, { env: repo.env }), [
    ['modules/two/src/b.ts', 'type rule'],
  ]);
});

test('filesystem fallback applies the scanner directory skips', (t) => {
  const repo = repository(t);
  for (const file of [
    'src/a.ts',
    'src/a.test.tsx',
    'node_modules/a.ts',
    'dist/a.ts',
    'src/.next/a.ts',
    'src/.expo/a.ts',
    'mobile/expo/ios/a.ts',
    'mobile/expo/android/a.ts',
  ]) {
    repo.write(file, 'export {};\n');
  }
  rmSync(join(repo.root, '.git'), { recursive: true });
  assert.deepEqual(trackedTypeFiles(repo.root, { env: repo.env }), [
    'src/.expo/a.ts',
    'src/.next/a.ts',
    'src/a.test.tsx',
    'src/a.ts',
  ]);
});

function fixtureSnapshot(root, directory = '') {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = directory ? `${directory}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? fixtureSnapshot(root, file)
      : [[file, readFileSync(join(root, file)).toString('hex')]];
  });
}

test('policy git ignores a decoy hook repository and preserves it byte for byte', async (t) => {
  const repo = fixture(t, `{ files: ['src/app/**'], rules: { '${RULE}': 'off' } }`);
  const decoy = repository(t);
  decoy.write('decoy.ts', 'export {};\n');
  decoy.commit();
  const before = fixtureSnapshot(decoy.root);
  const env = {
    ...repo.env,
    GIT_DIR: join(decoy.root, '.git'),
    GIT_INDEX_FILE: join(decoy.root, '.git/index'),
    GIT_WORK_TREE: decoy.root,
    GIT_COMMON_DIR: join(decoy.root, '.git'),
    GIT_PREFIX: 'decoy/',
  };
  assert.deepEqual(await workspacePolicyProblems(repo.root, { env }), [
    ['apps/one/src/app/a.ts', 'type rule'],
  ]);
  assert.deepEqual(fixtureSnapshot(decoy.root), before);
});

test('production inventory respects global safe-directory permission', (t) => {
  const repo = fixture(t);
  repo.write('global.gitconfig', `[safe]\n  directory = ${repo.root}\n`);
  const env = {
    ...repo.env,
    GIT_CONFIG_GLOBAL: join(repo.root, 'global.gitconfig'),
    GIT_TEST_ASSUME_DIFFERENT_OWNER: '1',
  };
  assert.deepEqual(trackedTypeFiles(repo.root, { env }), [
    'apps/one/src/a.harness-spec.ts',
    'apps/one/src/a.spec.ts',
    'apps/one/src/a.test.tsx',
    'apps/one/src/a.ts',
    'apps/one/src/app/a.ts',
    'apps/one/test/a.e2e-spec.ts',
  ]);
});

test('filesystem inventory preserves root and nested gitignore rules and negation', (t) => {
  const repo = repository(t);
  repo.write('.gitignore', 'generated/\n*.ignored.ts\n!kept.ignored.ts\n');
  repo.write('src/.gitignore', 'nested.ts\n');
  for (const file of [
    'src/a.ts',
    'generated/a.ts',
    'src/nested.ts',
    'src/no.ignored.ts',
    'kept.ignored.ts',
  ])
    repo.write(file, 'export {};\n');
  assert.deepEqual(trackedTypeFiles(repo.root, { filesystem: true }), [
    'kept.ignored.ts',
    'src/a.ts',
  ]);
});

test('filesystem inventory applies a parent gitignore to a nested project', (t) => {
  const repo = repository(t);
  repo.write('.gitignore', 'apps/project/generated/\n');
  repo.write('apps/project/src/a.ts', 'export {};\n');
  repo.write('apps/project/generated/a.ts', 'export {};\n');
  assert.deepEqual(trackedTypeFiles(join(repo.root, 'apps/project'), { filesystem: true }), [
    'src/a.ts',
  ]);
});

test('filesystem inventory respects an independent child repository boundary', (t) => {
  const repo = repository(t);
  repo.write('.gitignore', 'apps/project/\n');
  repo.write('apps/project/src/a.ts', 'export {};\n');
  mkdirSync(join(repo.root, 'apps/project/.git'));
  assert.deepEqual(trackedTypeFiles(join(repo.root, 'apps/project'), { filesystem: true }), [
    'src/a.ts',
  ]);
});

test('repository-free inventory includes uppercase TypeScript extensions', (t) => {
  const repo = repository(t);
  for (const file of ['src/a.TS', 'src/b.TSX', 'src/c.MTS', 'src/d.CTS'])
    repo.write(file, 'export {};\n');
  rmSync(join(repo.root, '.git'), { recursive: true });
  assert.deepEqual(trackedTypeFiles(repo.root, { env: repo.env }), [
    'src/a.TS',
    'src/b.TSX',
    'src/c.MTS',
    'src/d.CTS',
  ]);
});

test('policy inventory excludes tracked files removed from disk', (t) => {
  const repo = repository(t);
  repo.write('src/kept.ts', 'export {};\n');
  repo.write('src/removed.ts', 'export {};\n');
  repo.commit();
  rmSync(join(repo.root, 'src/removed.ts'));
  assert.deepEqual(trackedTypeFiles(repo.root, { env: repo.env }), ['src/kept.ts']);
});
