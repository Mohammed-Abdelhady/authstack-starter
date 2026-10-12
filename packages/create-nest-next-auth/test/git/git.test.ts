import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEMPLATE_FIXTURE = vi.hoisted(() => ({ path: '' }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { writeAnswersTemplate } = await import('../support/answers-fixture.js');
  const { templateDir } = await import('../../src/paths.js');
  return {
    ...actual,
    lstat: async (path: Parameters<typeof actual.lstat>[0]) =>
      actual.lstat(path === templateDir() ? TEMPLATE_FIXTURE.path : path),
    cp: async (_source: string, target: string): Promise<void> => {
      writeAnswersTemplate(target);
    },
  };
});

import { ANSWERS_FILE_NAME } from '../../src/constants/index.js';
import { initRepository } from '../../src/scaffold/git.js';
import { run as runCommand } from '../../src/utils/exec.js';
import { fixtureRoot, git, isolatedGit, run } from '../support/answers-helpers.js';
import { repositorySnapshot, seedRepository } from './git-fixture.js';

const roots: string[] = [];
const ANSWERS_BYTES = '{"schemaVersion":3,"rules":{"policy":"strict"}}\n';

beforeEach(() => {
  TEMPLATE_FIXTURE.path = fixtureRoot(roots);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function projectAt(root: string): string {
  const project = join(root, 'new-project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, ANSWERS_FILE_NAME), ANSWERS_BYTES);
  return project;
}

function expectOwnFirstCommit(project: string, env: NodeJS.ProcessEnv): void {
  expect(existsSync(join(project, '.git'))).toBe(true);
  expect
    .soft(git(['rev-parse', '--show-toplevel'], project, env).trim())
    .toBe(realpathSync(project));
  expect
    .soft(git(['rev-parse', '--absolute-git-dir'], project, env).trim())
    .toBe(join(realpathSync(project), '.git'));
  expect(git(['rev-list', '--count', 'HEAD'], project, env)).toBe('1\n');
  expect(git(['show', `HEAD:${ANSWERS_FILE_NAME}`], project, env)).toBe(ANSWERS_BYTES);
}

describe('git repository isolation', () => {
  it.each([true, false])(
    'does not change the caller repository with GIT_WORK_TREE set to %s',
    async (workTree) => {
      const root = fixtureRoot(roots);
      const caller = join(root, 'caller');
      const env = seedRepository(caller);
      const before = repositorySnapshot(caller, env);
      const project = projectAt(root);
      const { overrides } = isolatedGit(root);
      for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
      vi.stubEnv('GIT_DIR', join(caller, '.git'));
      vi.stubEnv('GIT_INDEX_FILE', join(caller, '.git', 'index'));
      vi.stubEnv('GIT_WORK_TREE', workTree ? caller : undefined);

      const result = await initRepository(project);
      const after = repositorySnapshot(caller, env);
      expect.soft(after.head).toEqual(before.head);
      expect.soft(after.branch).toEqual(before.branch);
      expect.soft(after.index).toEqual(before.index);
      expect.soft(after.config).toEqual(before.config);
      expect.soft(after.bare).toBe('false\n');
      expect(result).toEqual({ ok: true });
      expectOwnFirstCommit(project, env);
    },
  );

  it.each([
    ['GIT_OBJECT_DIRECTORY', 'objects'],
    ['GIT_ALTERNATE_OBJECT_DIRECTORIES', 'objects'],
    ['GIT_COMMON_DIR', '.'],
    ['GIT_INDEX_FILE', 'index'],
    ['GIT_SHALLOW_FILE', 'shallow'],
    ['GIT_GRAFT_FILE', 'grafts'],
  ])('ignores inherited %s paths', async (key, suffix) => {
    const root = fixtureRoot(roots);
    const caller = join(root, 'caller');
    const env = seedRepository(caller);
    const before = repositorySnapshot(caller, env);
    const project = projectAt(root);
    const { overrides } = isolatedGit(root);
    for (const [name, value] of Object.entries(overrides)) vi.stubEnv(name, value);
    vi.stubEnv(key, join(caller, '.git', suffix));

    expect(await initRepository(project)).toEqual({ ok: true });
    expect(repositorySnapshot(caller, env)).toEqual(before);
    expectOwnFirstCommit(project, env);
    expect(existsSync(join(project, '.git', 'objects', 'info', 'alternates'))).toBe(false);
  });

  it('ignores runtime config that redirects the working tree', async () => {
    const root = fixtureRoot(roots);
    const caller = join(root, 'caller');
    const env = seedRepository(caller);
    const before = repositorySnapshot(caller, env);
    const project = projectAt(root);
    const { overrides } = isolatedGit(root);
    for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.worktree');
    vi.stubEnv('GIT_CONFIG_VALUE_0', caller);

    expect(await initRepository(project)).toEqual({ ok: true });
    expect(repositorySnapshot(caller, env)).toEqual(before);
    expectOwnFirstCommit(project, env);
  });

  it('isolates git started by an installation child process', async () => {
    const root = fixtureRoot(roots);
    const caller = join(root, 'caller');
    const env = seedRepository(caller);
    const before = repositorySnapshot(caller, env);
    const project = projectAt(root);
    const { overrides } = isolatedGit(root);
    for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
    vi.stubEnv('GIT_DIR', join(caller, '.git'));
    vi.stubEnv('GIT_INDEX_FILE', join(caller, '.git', 'index'));
    vi.stubEnv('GIT_WORK_TREE', caller);
    expect(await initRepository(project)).toEqual({ ok: true });

    const child = await runCommand(
      process.execPath,
      [
        '--input-type=commonjs',
        '-e',
        `const { execFileSync } = require('node:child_process');
        const options = { encoding: 'utf8', env: process.env };
        execFileSync('git', ['config', '--local', 'core.hooksPath', 'installer-test-hooks'], options);
        process.stdout.write(execFileSync('git', ['rev-parse', '--show-toplevel'], options));`,
      ],
      project,
    );
    expect.soft(child).toEqual({ code: 0, stdout: `${realpathSync(project)}\n`, stderr: '' });
    expect.soft(repositorySnapshot(caller, env)).toEqual(before);
    expect(git(['config', '--local', '--get', 'core.hooksPath'], project, env)).toBe(
      'installer-test-hooks\n',
    );
  });

  it.each(['caller', 'caller with spaces', 'caller '])(
    'creates its own repository inside %j and reports that work tree',
    async (directory) => {
      const root = fixtureRoot(roots);
      const caller = join(root, directory);
      const env = seedRepository(caller);
      const before = repositorySnapshot(caller, env);
      const project = join(caller, 'nested', 'app');
      const { overrides } = isolatedGit(root);
      const warning = vi.spyOn(log, 'warn');

      const { code, output } = await run(root, [project, '--yes', '--no-install'], {
        env: overrides,
      });
      expect(code, output).toBe(0);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(realpathSync(caller)));
      expect(repositorySnapshot(caller, env)).toEqual(before);
      expect(existsSync(join(project, '.git'))).toBe(true);
      expect
        .soft(git(['rev-parse', '--show-toplevel'], project, env).trim())
        .toBe(realpathSync(project));
      expect
        .soft(git(['rev-parse', '--absolute-git-dir'], project, env).trim())
        .toBe(join(realpathSync(project), '.git'));
      expect(git(['rev-list', '--count', 'HEAD'], project, env)).toBe('1\n');
      expect(git(['ls-tree', '--name-only', 'HEAD'], project, env).split('\n')).toContain(
        ANSWERS_FILE_NAME,
      );
    },
  );
});
