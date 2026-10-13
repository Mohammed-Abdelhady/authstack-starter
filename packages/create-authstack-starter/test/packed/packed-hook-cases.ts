import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { git } from '../support/answers-helpers.js';
import { boundedGitPush } from '../support/bounded-git-push.js';

// The recursive lint reaches shared/core first and stops there. A probe in the
// backend made every refused push wait for the whole backend lint as well.
const PROBE_PATH = 'shared/core/src/hook probe.ts';
const INVALID_SOURCE = 'const unusedHookProbe = 1;\nexport {};\n';
const UNSTAGED_SOURCE = 'export const unstagedHookProbe = 2;\n';
const CLEAN_SOURCE = 'export const hookProbe = 1;\n';
const UNUSED_RULE = '@typescript-eslint/no-unused-vars';

/** Only one generated hook is installed here; tools and Git remain real. */
function isolateHook(project: string, name: string, env: NodeJS.ProcessEnv): void {
  const hooks = join(project, '.git', `only-${name}`);
  mkdirSync(hooks);
  const hook = join(hooks, name);
  copyFileSync(join(project, '.husky', name), hook);
  chmodSync(hook, 0o755);
  git(['config', 'core.hooksPath', hooks], project, env);
}

function commit(
  project: string,
  message: string,
  env: NodeJS.ProcessEnv,
): {
  status: number | null;
  output: string;
} {
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: project,
    env,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

export function exerciseInstalledHooks(project: string, env: NodeJS.ProcessEnv): void {
  // The project's actual prepare lifecycle, not this fixture, must activate Husky.
  expect(git(['config', '--local', '--get', 'core.hooksPath'], project, env).trim()).toBe(
    '.husky/_',
  );
  git(['config', 'user.name', 'Hook Fixture'], project, env);
  git(['config', 'user.email', 'hooks@example.test'], project, env);
  const initial = git(['rev-parse', 'HEAD'], project, env).trim();

  isolateHook(project, 'pre-commit', env);
  writeFileSync(join(project, PROBE_PATH), INVALID_SOURCE);
  git(['add', '--', PROBE_PATH], project, env);
  writeFileSync(join(project, PROBE_PATH), UNSTAGED_SOURCE);
  const preCommit = commit(project, 'test: staged hook probe', env);
  expect(
    {
      status: preCommit.status,
      refusedByLint: preCommit.output.includes(UNUSED_RULE),
      headMoved: git(['rev-parse', 'HEAD'], project, env).trim() !== initial,
      staged: git(['show', `:${PROBE_PATH}`], project, env),
      unstaged: readFileSync(join(project, PROBE_PATH), 'utf8'),
    },
    preCommit.output,
  ).toEqual({
    status: 1,
    refusedByLint: true,
    headMoved: false,
    staged: 'const unusedHookProbe = 1;\nexport {};\n',
    unstaged: 'export const unstagedHookProbe = 2;\n',
  });

  isolateHook(project, 'commit-msg', env);
  writeFileSync(join(project, PROBE_PATH), CLEAN_SOURCE);
  git(['add', '--', PROBE_PATH], project, env);
  const commitMessage = commit(project, 'invalid message', env);
  expect(
    {
      status: commitMessage.status,
      refusedByFormat:
        commitMessage.output.includes('[subject-empty]') &&
        commitMessage.output.includes('[type-empty]'),
      headMoved: git(['rev-parse', 'HEAD'], project, env).trim() !== initial,
    },
    commitMessage.output,
  ).toEqual({ status: 1, refusedByFormat: true, headMoved: false });

  // Commit-msg is the only enabled hook and the source is clean here.
  const valid = commit(project, 'test: valid hook probe', env);
  expect(valid.status, valid.output).toBe(0);
  const baseline = git(['rev-parse', 'HEAD'], project, env).trim();
  const branch = git(['branch', '--show-current'], project, env).trim();
  const remote = join(project, '.git', 'hook-remote.git');
  git(['init', '--bare', remote], project, env);
  git(['remote', 'add', 'hook-fixture', remote], project, env);
  const seeded = boundedGitPush(['hook-fixture', branch], project, env);
  expect(seeded.status, `${seeded.stdout}${seeded.stderr}`).toBe(0);

  writeFileSync(join(project, PROBE_PATH), INVALID_SOURCE);
  git(['add', '--', PROBE_PATH], project, env);
  const offending = commit(project, 'test: lint refusal on push', env);
  expect(offending.status, offending.output).toBe(0);
  const beforePush = git(['rev-parse', 'HEAD'], project, env).trim();
  isolateHook(project, 'pre-push', env);
  const push = boundedGitPush(['hook-fixture', branch], project, env);
  expect(
    {
      status: push.status,
      refusedByLint: `${push.stdout}${push.stderr}`.includes(UNUSED_RULE),
      headMoved: git(['rev-parse', 'HEAD'], project, env).trim() !== beforePush,
      remoteMoved: git(['rev-parse', `refs/heads/${branch}`], remote, env).trim() !== baseline,
    },
    `${push.stdout}${push.stderr}`,
  ).toEqual({ status: 1, refusedByLint: true, headMoved: false, remoteMoved: false });
}
