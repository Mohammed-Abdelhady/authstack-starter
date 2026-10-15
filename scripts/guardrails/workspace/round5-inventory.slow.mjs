import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installChecker, repository } from '../test-repository.mjs';
import { trackedTypeFiles } from './workspace-policy.mjs';
import { installWorkspaceTools, installPolicyTestDependencies } from './workspace-tool-fixture.mjs';

test('filesystem inventory stops ancestor ignores at the nearest repository', (t) => {
  const repo = repository(t);
  repo.write('.gitignore', 'child/apps/project/src/a.ts\n');
  repo.write('child/apps/project/src/a.ts', 'export {};\n');
  repo.git('-C', 'child', 'init', '--initial-branch=fixture');
  assert.deepEqual(trackedTypeFiles(join(repo.root, 'child/apps/project'), { filesystem: true }), [
    'src/a.ts',
  ]);
});

test('filesystem inventory honors a child negation of an ancestor file rule', (t) => {
  const repo = repository(t);
  repo.write('.gitignore', 'src/restored.ts\n');
  repo.write('src/.gitignore', '!restored.ts\n');
  repo.write('src/restored.ts', 'export {};\n');
  assert.deepEqual(trackedTypeFiles(repo.root, { filesystem: true }), ['src/restored.ts']);
});

test('filesystem inventory excludes TypeScript-looking Git metadata', (t) => {
  const repo = repository(t);
  repo.write('.git/metadata.ts', 'export {};\n');
  repo.write('src/a.ts', 'export {};\n');
  assert.deepEqual(trackedTypeFiles(repo.root, { filesystem: true }), ['src/a.ts']);
});

for (const configuration of ['parameters', 'counted']) {
  test(`policy listing preserves safe-directory permission from ${configuration}`, (t) => {
    const repo = repository(t);
    repo.write('src/a.ts', 'export {};\n');
    repo.commit();
    const permission =
      configuration === 'parameters'
        ? { GIT_CONFIG_PARAMETERS: `'safe.directory=${repo.root}'` }
        : {
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'safe.directory',
            GIT_CONFIG_VALUE_0: repo.root,
          };
    assert.deepEqual(
      trackedTypeFiles(repo.root, {
        env: { ...repo.env, ...permission, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' },
      }),
      ['src/a.ts'],
    );
  });
}

test('the repository policy test succeeds without launching Git', (t) => {
  const repo = repository(t);
  installChecker(repo.root, { directory: 'scripts' });
  const policyTest = fileURLToPath(new URL('../../eslint-policy.test.mjs', import.meta.url));
  copyFileSync(policyTest, join(repo.root, 'scripts/eslint-policy.test.mjs'));
  copyFileSync(
    fileURLToPath(new URL('./workspace-policy.mjs', import.meta.url)),
    join(repo.root, 'scripts/guardrails/workspace/workspace-policy.mjs'),
  );
  repo.write('package.json', JSON.stringify({ workspaces: ['apps/*'] }));
  repo.write('apps/one/package.json', JSON.stringify({
    type: 'module', devDependencies: { eslint: '^9.39.5', 'typescript-eslint': '^8.70.1' },
  }));
  repo.write('apps/one/src/a.ts', 'export {};\n');
  repo.write(
    'apps/one/eslint.config.mjs',
    `import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended,
  { linterOptions: { noInlineConfig: true } });\n`,
  );
  installWorkspaceTools(repo.root, 'apps/one');
  installPolicyTestDependencies(repo.root);
  // Node 24's default reporter prints no TAP summary lines.
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', 'scripts/eslint-policy.test.mjs'],
    {
      cwd: repo.root,
      env: repo.env,
      encoding: 'utf8',
    },
  );
  assert.deepEqual(
    {
      status: result.status,
      passed: Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]),
      failed: Number(result.stdout.match(/^# fail (\d+)$/m)?.[1]),
    },
    { status: 0, passed: 1, failed: 0 },
  );
});
