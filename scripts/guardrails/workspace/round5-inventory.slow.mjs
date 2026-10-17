import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { repository } from '../test-repository.mjs';
import { trackedTypeFiles } from './workspace-policy.mjs';

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
