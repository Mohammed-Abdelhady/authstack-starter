import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, constants, existsSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture, isRunning, push, remote, received } from './round8-hook-fixture.mjs';

test('a hanging real push hook fails clearly and stops its owned descendants', (t) => {
  const repo = fixture(t);
  const target = remote(t, repo, 'target');
  const fifo = join(repo.root, 'push-block');
  execFileSync('mkfifo', [fifo], { cwd: repo.root, env: repo.env });
  repo.write(
    'scripts/block.mjs',
    "import { spawn } from 'node:child_process';\n" +
      "import { readFileSync, writeFileSync } from 'node:fs';\n" +
      "const idle = ['-e', 'setInterval(() => {}, 1000)'];\n" +
      "const child = spawn(process.execPath, idle, { detached: true, stdio: 'ignore' });\n" +
      "writeFileSync('.git/own-group-pid', String(child.pid));\n" +
      "writeFileSync('.git/hanging-pid', String(process.pid));\n" +
      "readFileSync('push-block');\n",
  );
  repo.write('.hooks/pre-push', '#!/bin/sh\nexec node scripts/block.mjs\n');
  chmodSync(join(repo.root, '.hooks/pre-push'), 0o755);
  try {
    assert.throws(
      () => push(repo, 'target', 'HEAD:blocked'),
      /Git push fixture timed out after 30000 ms/,
    );
    assert.equal(received(target, 'blocked'), null);
    // pnpm starts scripts the same way: outside the process group Git leads.
    assert.equal(isRunning(readFileSync(join(repo.root, '.git/own-group-pid'), 'utf8')), false);
    let writer;
    try {
      assert.throws(
        () => {
          writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
        },
        { code: 'ENXIO' },
      );
    } finally {
      if (writer !== undefined) closeSync(writer);
    }
  } finally {
    for (const name of ['hanging-pid', 'own-group-pid']) {
      const marker = join(repo.root, '.git', name);
      if (!existsSync(marker)) continue;
      try {
        process.kill(Number(readFileSync(marker, 'utf8')), 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
});

test('a failed push spawn preserves its boundary error and leaves the remote unchanged', (t) => {
  const repo = fixture(t);
  const target = remote(t, repo, 'target');
  repo.env.PATH = join(repo.root, 'missing-tools');
  assert.throws(() => push(repo, 'target', 'HEAD:blocked'), { code: 'ENOENT' });
  assert.equal(received(target, 'blocked'), null);
});
