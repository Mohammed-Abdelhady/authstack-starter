import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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

import { fixtureRoot, git, isolatedGit, run } from '../support/answers-helpers.js';

const roots: string[] = [];
const HOOK_REASON = 'commit refused by the fixture hook';

beforeEach(() => {
  TEMPLATE_FIXTURE.path = fixtureRoot(roots);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Whether the boxed summary states the fact, and whether the closing line was
 * printed. The box wraps long lines, so its borders and breaks are removed.
 */
function observed(output: string, fact: string): { stated: boolean; done: boolean } {
  const text = output
    .split('\n')
    .map((line) => line.replace(/^[│├◇└]\s*/u, '').replace(/\s*│$/u, ''))
    .join(' ');
  return { stated: text.includes(fact), done: text.includes('Done.') };
}

it('exits 0 and closes with Done. when git is created and nothing fails', async () => {
  const root = fixtureRoot(roots);
  const project = join(root, 'app');
  const { env, overrides } = isolatedGit(root);

  const { code, output } = await run(root, [project, '--yes', '--no-install'], { env: overrides });

  expect({
    code,
    ...observed(output, 'Git repository and first commit: created Dependencies:'),
  }).toEqual({ code: 0, stated: true, done: true });
  expect(git(['rev-list', '--count', 'HEAD'], project, env)).toBe('1\n');
});

it('exits 0 when git was not requested', async () => {
  const root = fixtureRoot(roots);
  const project = join(root, 'app');
  const { overrides } = isolatedGit(root);

  const { code, output } = await run(root, [project, '--yes', '--no-install', '--no-git'], {
    env: overrides,
  });

  expect({
    code,
    ...observed(output, 'Git repository and first commit: not-requested Dependencies:'),
  }).toEqual({ code: 0, stated: true, done: true });
  expect(existsSync(join(project, '.git'))).toBe(false);
});

it('exits 1 and reports failed when the first commit is rejected', async () => {
  const root = fixtureRoot(roots);
  const project = join(root, 'app');
  const { env, overrides } = isolatedGit(root);
  const hooks = join(root, 'rejecting-hooks');
  mkdirSync(hooks);
  writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\necho "${HOOK_REASON}" >&2\nexit 1\n`);
  chmodSync(join(hooks, 'pre-commit'), 0o755);
  // The installer drops GIT_CONFIG_GLOBAL, so its git reads HOME/.gitconfig.
  writeFileSync(join(root, '.gitconfig'), `[core]\n\thooksPath = ${hooks}\n`);

  const { code, output } = await run(root, [project, '--yes', '--no-install'], { env: overrides });

  expect({
    code,
    ...observed(output, `Git repository and first commit: failed. ${HOOK_REASON} Dependencies:`),
  }).toEqual({ code: 1, stated: true, done: false });
  expect(git(['rev-list', '--count', '--all'], project, env)).toBe('0\n');
});

it('exits 1 and reports failed when git init cannot run', async () => {
  const root = fixtureRoot(roots);
  const project = join(root, 'app');
  const { overrides } = isolatedGit(root);
  const withoutGit = mkdtempSync(join(tmpdir(), 'cna-no-git-'));
  roots.push(withoutGit);

  const { code, output } = await run(root, [project, '--yes', '--no-install'], {
    env: { ...overrides, PATH: withoutGit },
  });

  expect({
    code,
    ...observed(output, 'Git repository and first commit: failed. spawn git ENOENT Dependencies:'),
  }).toEqual({ code: 1, stated: true, done: false });
  expect(existsSync(join(project, '.git'))).toBe(false);
});

it('exits 1 when the lockfile had to be removed under --no-install', async () => {
  const root = fixtureRoot(roots);
  const project = join(root, 'app');
  const { overrides } = isolatedGit(root);

  const { code, output } = await run(root, [project, '--yes', '--no-install', '--no-git'], {
    env: { ...overrides, PATH: '' },
  });

  expect({
    code,
    ...observed(
      output,
      'Lockfile: removed. pnpm@12.6.0 is required to update the lockfile. Enable pnpm with Corepack and run pnpm install to regenerate it. Git repository',
    ),
  }).toEqual({ code: 1, stated: true, done: false });
  expect(existsSync(join(project, 'pnpm-lock.yaml'))).toBe(false);
});
