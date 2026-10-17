import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gitEnvironment } from '../git/git-environment.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'pnpm-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('hooks invoke installed tools through pnpm and preserve a failing gate', (t) => {
  const root = temporary(t);
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  copyFileSync(
    join(ROOT, 'scripts/lib/require-package-manager.sh'),
    join(root, 'scripts/lib/require-package-manager.sh'),
  );
  for (const file of [
    'scripts/check-workspace-dependencies.mjs',
    'scripts/lib/package-imports.mjs',
  ]) {
    copyFileSync(join(ROOT, file), join(root, file));
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', workspaces: [] }));
  writeFileSync(
    join(root, 'scripts/check-hard-bans.mjs'),
    "import { appendFileSync } from 'node:fs'; appendFileSync('calls', 'checker ' + process.argv.slice(2).join(' ') + '\\n'); if (process.env.FAIL_CHECKER === '1') process.exit(1);",
  );
  const binary = join(root, 'bin/pnpm');
  writeFileSync(
    binary,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> calls\nif [ "$*" = "$FAIL_COMMAND" ]; then exit 1; fi\n',
  );
  chmodSync(binary, 0o755);
  const env = gitEnvironment({ PATH: `${join(root, 'bin')}:${process.env.PATH}`, HOME: root });
  for (const [hook, args, expected, status, failure] of [
    [
      'commit-msg',
      ['message'],
      ['exec commitlint --edit message', 'checker --commit-msg message'],
      0,
      '',
    ],
    [
      'commit-msg',
      ['message'],
      ['exec commitlint --edit message'],
      1,
      'exec commitlint --edit message',
    ],
    ['pre-commit', [], ['exec lint-staged', 'checker --staged'], 0, ''],
    ['pre-commit', [], ['exec lint-staged'], 1, 'exec lint-staged'],
    [
      'pre-push',
      ['origin', 'synthetic'],
      ['checker --push --hook origin synthetic', 'run lint', 'run typecheck'],
      1,
      'run typecheck',
    ],
    ['pre-push', ['origin', 'synthetic'], ['checker --push --hook origin synthetic'], 1, 'checker'],
  ]) {
    writeFileSync(join(root, 'calls'), '');
    const result = spawnSync('sh', [join(ROOT, '.husky', hook), ...args], {
      cwd: root,
      env: { ...env, FAIL_COMMAND: failure, FAIL_CHECKER: failure === 'checker' ? '1' : '0' },
      encoding: 'utf8',
    });
    assert.equal(result.status, status, result.stderr);
    assert.deepEqual(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n'), expected);
  }
});

test('each hook stops before tools or gates when pnpm is missing', (t) => {
  const root = temporary(t);
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  copyFileSync(
    join(ROOT, 'scripts/lib/require-package-manager.sh'),
    join(root, 'scripts/lib/require-package-manager.sh'),
  );
  symlinkSync('/bin/sh', join(root, 'bin/sh'));
  for (const hook of ['commit-msg', 'pre-commit', 'pre-push']) {
    const result = spawnSync('/bin/sh', [join(ROOT, '.husky', hook), 'message'], {
      cwd: root,
      env: gitEnvironment({ PATH: join(root, 'bin') }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 1, hook);
    assert.match(result.stderr, /pnpm/);
    assert.doesNotMatch(result.stderr, /not found|Cannot find/);
    assert.equal(result.stdout, '');
  }
});
