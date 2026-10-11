import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repository } from '../test-repository.mjs';

/** The Git commands a traced command started, by their first two words. */
function started(trace) {
  return [...trace.matchAll(/trace: run_command: (?:\S+=\S+ )*git (\S+ \S+)/g)].map(
    (match) => match[1],
  );
}

for (const layout of ['nested', 'separate git directory']) {
  test(`a ${layout} repository made with a fixture's environment starts no maintenance`, (t) => {
    const outer = repository(t);
    const root = join(outer.root, 'apps/project');
    mkdirSync(root, { recursive: true });
    const run = (...args) =>
      spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: root,
        env: { ...outer.env, GIT_TRACE: '1' },
        encoding: 'utf8',
      });
    const separate = layout === 'nested' ? [] : ['--separate-git-dir', join(outer.root, 'data')];
    const created = run('init', '--initial-branch=feature', ...separate);
    const committed = run('commit', '--allow-empty', '-m', 'test: fixture');
    assert.deepEqual(
      {
        created: created.status,
        committed: committed.status,
        maintenance: started(committed.stderr).filter((command) =>
          command.startsWith('maintenance '),
        ),
      },
      { created: 0, committed: 0, maintenance: [] },
    );
  });
}
