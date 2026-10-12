import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { format, resolveConfig } from 'prettier';

// The template copy is the only boundary mocked; the manifest, the resolver,
// the pruner, the answers writer and git are the real ones.
vi.mock('../../src/scaffold/copy.js', async () => {
  const { writeAnswersTemplate } = await import('../support/answers-fixture.js');
  return {
    copyTemplate: async (_source: string, target: string): Promise<void> => {
      writeAnswersTemplate(target);
    },
  };
});

import { ANSWERS_FILE_NAME, GIT_FALLBACK_NAME } from '../../src/constants/index.js';
import { loadManifest } from '../../src/manifest/load.js';
import { matchesGlob } from '../../src/utils/glob.js';
import {
  fixtureRoot,
  git,
  isolatedGit,
  installerVersion,
  manifestGlobs,
  readAnswers,
  run,
  REPO_ROOT,
  TEMPLATE_SHA,
} from '../support/answers-helpers.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('.create-nest-next-auth.json', () => {
  it('records the contract and the default resolved answers', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    const version = installerVersion();
    const { code, output } = await run(root, [project, '--yes', '--no-install', '--no-git']);
    expect(code, output).toBe(0);

    const { raw, record } = readAnswers(project, ANSWERS_FILE_NAME);
    expect(record).toEqual({
      schemaVersion: 3,
      rules: { policy: 'strict' },
      packageManager: 'pnpm@12.6.0',
      installer: { name: 'create-nest-next-auth', version },
      template: { sha256: TEMPLATE_SHA },
      answers: {
        targets: ['web'],
        database: 'mongodb',
        features: ['email-password', 'facebook', 'github', 'google', 'oauth-core'],
        options: ['docker', 'locale-ar', 'production'],
        locales: ['ar', 'en'],
      },
    });
    expect(raw).toBe(
      `{
  "schemaVersion": 3,
  "packageManager": "pnpm@12.6.0",
  "rules": {
    "policy": "strict"
  },
  "installer": {
    "name": "create-nest-next-auth",
    "version": "${version}"
  },
  "template": {
    "sha256": "${TEMPLATE_SHA}"
  },
  "answers": {
    "targets": ["web"],
    "database": "mongodb",
    "features": ["email-password", "facebook", "github", "google", "oauth-core"],
    "options": ["docker", "locale-ar", "production"],
    "locales": ["ar", "en"]
  }
}
`,
    );
  });

  it('records a feature the resolver pulled in for another one', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    const { code, output } = await run(root, [
      project,
      '--yes',
      '--no-install',
      '--no-git',
      '--features',
      'google',
    ]);
    expect(code, output).toBe(0);

    const { record } = readAnswers(project, ANSWERS_FILE_NAME);
    expect(record.answers.features).toEqual(['google', 'oauth-core']);
  });

  it('produces identical bytes for identical input', async () => {
    const root = fixtureRoot(roots);
    const first = join(root, 'first');
    const second = join(root, 'second');
    const one = await run(root, [first, '--yes', '--no-install', '--no-git']);
    const two = await run(root, [second, '--yes', '--no-install', '--no-git']);
    expect(one.code, one.output).toBe(0);
    expect(two.code, two.output).toBe(0);

    const firstBytes = readFileSync(join(first, ANSWERS_FILE_NAME));
    const secondBytes = readFileSync(join(second, ANSWERS_FILE_NAME));
    expect(firstBytes.equals(secondBytes)).toBe(true);
  });

  it('records the same bytes whatever order the flags arrive in', async () => {
    const root = fixtureRoot(roots);
    const first = join(root, 'flag-order-a');
    const second = join(root, 'flag-order-b');
    const one = await run(root, [
      first,
      '--yes',
      '--no-install',
      '--no-git',
      '--features',
      'github,google',
    ]);
    const two = await run(root, [
      second,
      '--yes',
      '--no-install',
      '--no-git',
      '--features',
      'google,github',
    ]);
    expect(one.code, one.output).toBe(0);
    expect(two.code, two.output).toBe(0);

    const firstRaw = readFileSync(join(first, ANSWERS_FILE_NAME), 'utf8');
    const secondRaw = readFileSync(join(second, ANSWERS_FILE_NAME), 'utf8');
    expect(firstRaw).toBe(secondRaw);
    expect(readAnswers(first, ANSWERS_FILE_NAME).record.answers.features).toEqual([
      'github',
      'google',
      'oauth-core',
    ]);
  });

  it('records options turned off as resolved', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    const { code, output } = await run(root, [
      project,
      '--yes',
      '--no-install',
      '--no-git',
      '--no-docker',
      '--no-production',
      '--locales',
      'en',
    ]);
    expect(code, output).toBe(0);

    const { record } = readAnswers(project, ANSWERS_FILE_NAME);
    expect(record.answers).toEqual({
      targets: ['web'],
      database: 'mongodb',
      features: ['email-password', 'facebook', 'github', 'google', 'oauth-core'],
      options: [],
      locales: ['en'],
    });
  });

  it('is not written on --dry-run', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    mkdirSync(project, { recursive: true });

    const { code, output } = await run(root, [
      project,
      '--yes',
      '--dry-run',
      '--no-install',
      '--no-git',
    ]);
    expect(code, output).toBe(0);
    expect(readdirSync(project)).toEqual([]);
  });

  it('is written when git is off', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    const { code, output } = await run(root, [project, '--yes', '--no-install', '--no-git']);
    expect(code, output).toBe(0);

    expect(existsSync(join(project, ANSWERS_FILE_NAME))).toBe(true);
    expect(existsSync(join(project, '.git'))).toBe(false);
  });

  it('is in the first commit of a real repository under an isolated identity', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    const { env, overrides } = isolatedGit(root);
    const { code, output } = await run(root, [project, '--yes', '--no-install'], {
      env: overrides,
    });
    expect(code, output).toBe(0);

    expect(git(['rev-list', '--count', 'HEAD'], project, env)).toBe('1\n');
    const rootCommits = git(['rev-list', '--max-parents=0', 'HEAD'], project, env)
      .trim()
      .split('\n');
    expect(rootCommits).toHaveLength(1);
    const tree = git(['ls-tree', '-r', '--name-only', rootCommits[0]], project, env).split('\n');
    expect(tree).toContain(ANSWERS_FILE_NAME);
    expect(git(['log', '-1', '--format=%an'], project, env)).toBe(`${GIT_FALLBACK_NAME}\n`);
  });

  it('is listed in no prune rule and is not ignored by git', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    const { env, overrides } = isolatedGit(root);
    const { code, output } = await run(root, [project, '--yes', '--no-install'], {
      env: overrides,
    });
    expect(code, output).toBe(0);

    const globs = manifestGlobs(await loadManifest(REPO_ROOT));
    expect(globs.filter((glob) => matchesGlob(ANSWERS_FILE_NAME, glob))).toEqual([]);

    const ignored = spawnSync('git', ['check-ignore', '--no-index', ANSWERS_FILE_NAME], {
      cwd: project,
      encoding: 'utf8',
      env,
    });
    expect(ignored.status).toBe(1);

    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', ANSWERS_FILE_NAME], {
      cwd: project,
      encoding: 'utf8',
      env,
    });
    expect(tracked.status).toBe(0);
  });

  it('carries no key outside the contract', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    const { code, output } = await run(root, [project, '--yes', '--no-install', '--no-git']);
    expect(code, output).toBe(0);

    const { raw, record } = readAnswers(project, ANSWERS_FILE_NAME);
    expect(Object.keys(record)).toEqual([
      'schemaVersion',
      'packageManager',
      'rules',
      'installer',
      'template',
      'answers',
    ]);
    expect(Object.keys(record.installer)).toEqual(['name', 'version']);
    expect(Object.keys(record.template)).toEqual(['sha256']);
    expect(Object.keys(record.answers)).toEqual([
      'targets',
      'database',
      'features',
      'options',
      'locales',
    ]);
    expect(record.schemaVersion).toBe(3);
    expect(raw).not.toContain(project);
    expect(raw).not.toContain('createdAt');
  });

  it('is already formatted the way the generated project formats', async () => {
    const root = fixtureRoot(roots);
    const project = join(root, 'app');
    const { code, output } = await run(root, [project, '--yes', '--no-install', '--no-git']);
    expect(code, output).toBe(0);

    const path = join(project, ANSWERS_FILE_NAME);
    const config = await resolveConfig(path);
    expect(config).toMatchObject({ singleQuote: true, tabWidth: 2 });
    const raw = readFileSync(path, 'utf8');
    expect(await format(raw, { ...(config ?? {}), filepath: path })).toBe(raw);
  });
});
