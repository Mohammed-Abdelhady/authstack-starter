import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { git, isolatedGit } from '../support/answers-helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The Git commands a traced command started, by their first two words. */
function started(trace: string): string[] {
  return [...trace.matchAll(/trace: run_command: (?:\S+=\S+ )*git (\S+ \S+)/g)].map(
    (match) => match[1],
  );
}

it('starts no background maintenance after a commit or a received push', () => {
  const root = mkdtempSync(join(tmpdir(), 'cna-isolated-git-'));
  roots.push(root);
  const { env } = isolatedGit(root);
  const traced = { ...env, GIT_TRACE: '1' };
  git(['init', '--initial-branch=main'], root, env);
  git(['config', 'user.name', 'Fixture'], root, env);
  git(['config', 'user.email', 'fixture@example.test'], root, env);
  git(['init', '--bare', '--initial-branch=main', join(root, 'destination.git')], root, env);

  const commit = spawnSync('git', ['commit', '--allow-empty', '-m', 'test: fixture'], {
    cwd: root,
    env: traced,
    encoding: 'utf8',
  });
  const push = spawnSync('git', ['push', join(root, 'destination.git'), 'main'], {
    cwd: root,
    env: traced,
    encoding: 'utf8',
  });

  expect({
    commit: commit.status,
    push: push.status,
    maintenance: started(`${commit.stderr}${push.stderr}`).filter((command) =>
      command.startsWith('maintenance '),
    ),
    received: git(['rev-parse', 'refs/heads/main'], join(root, 'destination.git'), env),
  }).toEqual({
    commit: 0,
    push: 0,
    maintenance: [],
    received: git(['rev-parse', 'HEAD'], root, env),
  });
});
