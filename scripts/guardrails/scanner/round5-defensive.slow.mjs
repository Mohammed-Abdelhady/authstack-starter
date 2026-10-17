import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { repository, outcome } from '../test-repository.mjs';

const TOKEN = 'inner' + 'HTML';
const ENCODED_MODULE = new URL('./encoded-diff.mjs', import.meta.url).href;
const ENV_MODULE = new URL('../git/git-environment.mjs', import.meta.url).href;

function encodedResult(repo, failure) {
  const scratch = join(repo.root, 'scratch');
  mkdirSync(scratch);
  const env = { ...repo.env, TMPDIR: scratch };
  if (failure) {
    const executable = execFileSync('which', ['git'], {
      cwd: repo.root,
      env: repo.env,
      encoding: 'utf8',
    }).trim();
    repo.write(
      'bin/git',
      `#!${process.execPath}
import { execFileSync } from 'node:child_process';
import { gitEnvironment } from ${JSON.stringify(ENV_MODULE)};
const args = process.argv.slice(2);
if (args.includes('--no-index')) {
  process.stdout.write('diff --git a/value.ts b/value.ts\\n--- a/value.ts\\n+++ b/value.ts\\n@@ -0,0 +1 @@\\n+export {};\\n');
  process.exit(2);
}
process.stdout.write(execFileSync(${JSON.stringify(executable)}, args,
  { cwd: process.cwd(), env: gitEnvironment(), stdio: 'pipe' }));\n`,
    );
    chmodSync(join(repo.root, 'bin/git'), 0o755);
    env.PATH = `${join(repo.root, 'bin')}:${env.PATH}`;
  }
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { encodedAddedLines } from ${JSON.stringify(ENCODED_MODULE)};
import { gitEnvironment } from ${JSON.stringify(ENV_MODULE)};
execFileSync('git', ['rev-parse', '--git-dir'],
  { cwd: process.cwd(), env: gitEnvironment(), stdio: 'pipe' });
const before = readdirSync(process.env.TMPDIR);
let lines;
let errorStatus = null;
try { lines = encodedAddedLines({ path: 'src/value.ts' }, 'export {};\\n'); }
catch (error) { errorStatus = error.status; }
console.log(JSON.stringify({ lines, errorStatus,
  temporary: readdirSync(process.env.TMPDIR).filter((name) => !before.includes(name)) }));`,
    ],
    { cwd: repo.root, env, encoding: 'utf8' },
  );
  return { status: result.status, ...JSON.parse(result.stdout) };
}

test('UTF-16 replacement of a gitlink scans new content without reading the old commit as a blob', (t) => {
  const repo = repository(t);
  repo.write('src/clean.ts', 'export {};\n');
  const commit = repo.commit();
  repo.git('update-index', '--add', '--cacheinfo', `160000,${commit},src/value.ts`);
  repo.git('commit', '--quiet', '-m', 'test: gitlink fixture');
  repo.write(
    'src/value.ts',
    Buffer.concat([Buffer.from([255, 254]), Buffer.from(`node.${TOKEN} = value;\n`, 'utf16le')]),
  );
  repo.git('add', 'src/value.ts');
  assert.deepEqual(outcome(repo.check('--staged')), {
    status: 1,
    hits: [['src/value.ts', 1, TOKEN]],
    caps: [],
  });
});

test('decoded diff success removes temporary files after returning added lines', (t) => {
  const repo = repository(t);
  assert.deepEqual(encodedResult(repo, false), {
    status: 0,
    lines: [{ line: 1, text: 'export {};' }],
    errorStatus: null,
    temporary: [],
  });
});

test('decoded diff failure propagates its status and removes temporary files', (t) => {
  const repo = repository(t);
  assert.deepEqual(encodedResult(repo, true), { status: 0, errorStatus: 2, temporary: [] });
});
