import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { main } from '../../src/cli.js';
import { TEMPLATE_IDENTITY_FILE } from '../../src/constants/index.js';
import type { AnswersRecord, Manifest } from '../../src/types.js';
import { writePnpmBoundary } from './pnpm-boundary.js';

export const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
export const REPO_ROOT = dirname(dirname(PACKAGE_DIR));

/** The identity every run ships: a hand-picked hex digest, not a computed one. */
export const TEMPLATE_SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export interface RunResult {
  code: number;
  output: string;
}

export interface RunOptions {
  /** Environment entries for the run; `undefined` deletes a key. Restored after. */
  env?: Record<string, string | undefined>;
  /** Root whose package.json the installer reads its own identity from. */
  installerRoot?: string;
}

/**
 * Runs the CLI in process against a manifest root. Environment overrides are
 * applied for the duration of the run and restored afterwards, so a temporary
 * repository cannot see the developer's git configuration or identity.
 */
export async function run(
  manifestRoot: string,
  argv: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const inheritedPath = process.env.PATH;
  const hasPathOverride = Object.hasOwn(options.env ?? {}, 'PATH');
  const noPnpm = hasPathOverride && !options.env?.PATH;
  const pnpmDirectory = noPnpm ? '' : mkdtempSync(join(tmpdir(), 'cna-test-pnpm-'));
  if (pnpmDirectory !== '') await writePnpmBoundary(pnpmDirectory);
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(options.env ?? {})) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (pnpmDirectory !== '') {
    process.env.PATH = [pnpmDirectory, process.env.PATH ?? ''].filter(Boolean).join(delimiter);
  }
  const stdout = vi.spyOn(process.stdout, 'write');
  const stderr = vi.spyOn(process.stderr, 'write');
  let code = 1;
  let output = '';
  try {
    code = await main(argv, manifestRoot, options.installerRoot);
    output = [...stdout.mock.calls, ...stderr.mock.calls].map((call) => String(call[0])).join('');
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (inheritedPath === undefined) delete process.env.PATH;
    else process.env.PATH = inheritedPath;
    if (pnpmDirectory !== '') rmSync(pnpmDirectory, { recursive: true, force: true });
  }
  return { code, output };
}

/**
 * A manifest root carrying the real manifest and, when identity content is
 * given, `template.identity.json` with exactly that content.
 */
export function manifestRootWith(roots: string[], identity?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'cna-answers-'));
  roots.push(root);
  copyFileSync(join(REPO_ROOT, 'template.manifest.json'), join(root, 'template.manifest.json'));
  if (identity !== undefined) {
    writeFileSync(join(root, TEMPLATE_IDENTITY_FILE), identity, 'utf8');
  }
  return root;
}

/** A manifest root for a healthy package: real manifest, default identity. */
export function fixtureRoot(roots: string[] = []): string {
  const identity = `${JSON.stringify({ sha256: TEMPLATE_SHA }, null, 2)}\n`;
  return manifestRootWith(roots, identity);
}

/** No background Git work: it would outlive the command and write into a folder being removed. */
const FIXTURE_GIT_CONFIG = [
  '[gc]',
  '\tauto = 0',
  '\tautoDetach = false',
  '[maintenance]',
  '\tauto = false',
  '\tautoDetach = false',
  '[core]',
  '\tfsmonitor = false',
  '[fetch]',
  '\twriteCommitGraph = false',
  '',
].join('\n');

/** A git environment blind to the developer's identity, plus its overrides. */
export function isolatedGit(root: string): {
  env: NodeJS.ProcessEnv;
  overrides: Record<string, string | undefined>;
} {
  const fixtureConfig = join(root, 'gitconfig-fixture');
  if (!existsSync(fixtureConfig)) writeFileSync(fixtureConfig, FIXTURE_GIT_CONFIG, 'utf8');
  const inheritedGitKeys = Object.keys(process.env).filter((key) => key.startsWith('GIT_'));
  const overrides: Record<string, string | undefined> = {
    ...Object.fromEntries(inheritedGitKeys.map((key) => [key, undefined])),
    HOME: root,
    XDG_CONFIG_HOME: root,
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
    GIT_CONFIG_GLOBAL: fixtureConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    // Deleted, not set: with every identity source gone, only the installer's
    // own fallback identity can sign the commit.
    GIT_AUTHOR_NAME: undefined,
    GIT_AUTHOR_EMAIL: undefined,
    GIT_COMMITTER_NAME: undefined,
    GIT_COMMITTER_EMAIL: undefined,
  };
  return { env: envWith(process.env, overrides), overrides };
}

/** A copy of an environment with the overrides applied. */
export function envWith(
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function git(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function readAnswers(
  project: string,
  fileName: string,
): { raw: string; record: AnswersRecord } {
  const raw = readFileSync(join(project, fileName), 'utf8');
  return { raw, record: JSON.parse(raw) as AnswersRecord };
}

/** The version on the installer's own package.json, the file's source of truth. */
export function installerVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'));
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'string') throw new Error('the installer package.json has no version');
  return version;
}

/** Every path the manifest could ever hand to the pruner. */
export function manifestGlobs(manifest: Manifest): string[] {
  return [
    ...manifest.core.alwaysRemoveFiles,
    ...Object.values(manifest.features).flatMap((feature) => [...feature.files, ...feature.docs]),
    ...Object.values(manifest.options).flatMap((option) => [...option.files, ...option.docs]),
    ...Object.values(manifest.targets).flatMap((target) => target.files),
    ...Object.values(manifest.databases).flatMap((database) => database.files),
    ...Object.values(manifest.shared).flatMap((shared) => shared.files),
  ];
}
