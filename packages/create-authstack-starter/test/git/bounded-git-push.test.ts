import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { GIT_PUSH_KILL_SIGNAL, GIT_PUSH_TIMEOUT_MS } from '../../src/constants/index.js';
import { git, isolatedGit, REPO_ROOT } from '../support/answers-helpers.js';
import { boundedGitPush } from '../support/bounded-git-push.js';
import { isRunning } from '../support/process-tree.js';

const FIXTURE_TIMEOUT_MS = 1000;
// Both codes mean the hook's reader has already gone, so there is nothing left to release.
const HOOK_READER_GONE_CODES = ['ENXIO', 'EPIPE'];
// Long enough for the hook to start Node and record its child before the bound fires.
const OWN_GROUP_TIMEOUT_MS = 3000;
const OWN_GROUP_HOOK =
  "import { spawn } from 'node:child_process';\n" +
  "import { writeFileSync } from 'node:fs';\n" +
  "const idle = ['-e', 'setInterval(() => {}, 1000)'];\n" +
  "const child = spawn(process.execPath, idle, { detached: true, stdio: 'ignore' });\n" +
  "writeFileSync('.git/own-group-pid', String(child.pid));\n" +
  'setInterval(() => {}, 1000);\n';
const roots: string[] = [];
const strays: number[] = [];
afterEach(() => {
  for (const pid of strays.splice(0)) if (isRunning(pid)) process.kill(pid, GIT_PUSH_KILL_SIGNAL);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function pushFixture(): { root: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), 'cna-push-bound-'));
  roots.push(root);
  const { env } = isolatedGit(root);
  git(['init', '--initial-branch=main'], root, env);
  git(['config', 'user.name', 'Fixture'], root, env);
  git(['config', 'user.email', 'fixture@example.test'], root, env);
  git(['commit', '--allow-empty', '-m', 'test: fixture'], root, env);
  git(['init', '--bare', '--initial-branch=main', join(root, 'destination.git')], root, env);
  git(['remote', 'add', 'origin', join(root, 'destination.git')], root, env);
  return { root, env };
}

it('reports a real blocked push as a timeout', () => {
  const { root, env } = pushFixture();
  execFileSync('mkfifo', [join(root, '.git/blocked')], { cwd: root, env });
  const hook = join(root, '.git/hooks/pre-push');
  writeFileSync(hook, '#!/bin/sh\necho $$ > .git/hook-pid\nread value < .git/blocked\n');
  chmodSync(hook, 0o755);
  try {
    expect(() => boundedGitPush(['origin', 'main'], root, env, FIXTURE_TIMEOUT_MS)).toThrow(
      'Git push fixture timed out after 1000 ms.',
    );
  } finally {
    releaseHook(root);
  }
});

it('stops a hook child that left the push process group before reporting the timeout', () => {
  const { root, env } = pushFixture();
  writeFileSync(join(root, '.git/own-group.mjs'), OWN_GROUP_HOOK);
  const hook = join(root, '.git/hooks/pre-push');
  writeFileSync(hook, `#!/bin/sh\nexec "${process.execPath}" .git/own-group.mjs\n`);
  chmodSync(hook, 0o755);
  const marker = join(root, '.git/own-group-pid');
  try {
    expect(() => boundedGitPush(['origin', 'main'], root, env, OWN_GROUP_TIMEOUT_MS)).toThrow(
      'Git push fixture timed out after 3000 ms.',
    );
  } finally {
    // Recorded even when the push fails another way, so the child never outlives the test.
    if (existsSync(marker)) strays.push(Number(readFileSync(marker, 'utf8')));
  }
  const child = Number(readFileSync(marker, 'utf8'));
  expect({ recorded: Number.isSafeInteger(child) && child > 0, running: isRunning(child) }).toEqual(
    {
      recorded: true,
      running: false,
    },
  );
});

it('keeps the same push budget as the repository guardrail fixtures', async () => {
  const policy: unknown = await import(
    pathToFileURL(join(REPO_ROOT, 'scripts/guardrails/policy.mjs')).href
  );
  expect({ installer: GIT_PUSH_TIMEOUT_MS, repository: policy }).toMatchObject({
    installer: 30_000,
    repository: { GIT_PUSH_TIMEOUT_MS: 30_000 },
  });
});

it('preserves a real rejected push status', () => {
  const { root, env } = pushFixture();
  const hook = join(root, '.git/hooks/pre-push');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  expect(boundedGitPush(['origin', 'main'], root, env).status).toBe(1);
});

it('propagates failure to start Git', () => {
  const { root, env } = pushFixture();
  let failure: unknown;
  try {
    boundedGitPush(['origin', 'main'], root, { ...env, PATH: '' });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ code: 'ENOENT' });
});

function releaseHook(root: string): void {
  const marker = join(root, '.git/hook-pid');
  if (existsSync(marker)) {
    try {
      const pid = Number(readFileSync(marker, 'utf8').trim());
      if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, GIT_PUSH_KILL_SIGNAL);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        !['ESRCH', 'EPERM'].includes(String(error.code))
      )
        throw error;
    }
  }
  let fd;
  try {
    fd = openSync(join(root, '.git/blocked'), constants.O_WRONLY | constants.O_NONBLOCK);
    writeSync(fd, 'release\n');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      !HOOK_READER_GONE_CODES.includes(String(error.code))
    )
      throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
