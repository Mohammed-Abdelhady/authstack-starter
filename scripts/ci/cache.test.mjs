import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { repository, installChecker } from '../guardrails/test-repository.mjs';
import { cacheMetadata } from './cache.mjs';

const CONFIG = JSON.parse(readFileSync(new URL('./gates.json', import.meta.url), 'utf8'));

test('cache metadata uses pnpm lock versions and fails on missing or invalid versions', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'ci-cache-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(
    join(cwd, 'pnpm-lock.yaml'),
    'packages:\n  mongodb-memory-server@11.3.0:\n    resolution: {}\nsnapshots:\n  mongodb-memory-server@11.3.0(supports-color@8.1.1):\n    dependencies: {}\n',
  );
  assert.deepEqual(cacheMetadata(CONFIG, cwd), {
    path: '.mongodb-binaries',
    key: 'mongodb-memory-server-11.3.0-mongod-8.2.6',
  });
  writeFileSync(
    join(cwd, 'pnpm-lock.yaml'),
    'packages:\n  mongodb-memory-server@11.4.0:\n    resolution: {}\nsnapshots:\n  mongodb-memory-server@11.4.0(supports-color@8.1.1):\n    dependencies: {}\n',
  );
  assert.deepEqual(cacheMetadata(CONFIG, cwd), {
    path: '.mongodb-binaries',
    key: 'mongodb-memory-server-11.4.0-mongod-8.2.6',
  });
  assert.deepEqual(
    cacheMetadata(
      { ...CONFIG, environment: { ...CONFIG.environment, MONGOMS_VERSION: '8.2.7' } },
      cwd,
    ),
    {
      path: '.mongodb-binaries',
      key: 'mongodb-memory-server-11.4.0-mongod-8.2.7',
    },
  );
  assert.throws(() => cacheMetadata({ ...CONFIG, environment: {} }, cwd), /Mongo binary version/);
  assert.throws(
    () => cacheMetadata({ ...CONFIG, environment: { MONGOMS_VERSION: '../bad' } }, cwd),
    /Mongo binary version/,
  );
  writeFileSync(join(cwd, 'pnpm-lock.yaml'), '{}');
  assert.throws(() => cacheMetadata(CONFIG, cwd), /Mongo.*version/);
  writeFileSync(
    join(cwd, 'pnpm-lock.yaml'),
    'packages:\n  mongodb-memory-server@11.invalid:\n    resolution: {}\n',
  );
  assert.throws(() => cacheMetadata(CONFIG, cwd), /Mongo.*version/);
});

test('the entry point passes configured Mongo settings to its real gate subprocess', (t) => {
  const repo = repository(t);
  installChecker(repo.root, { directory: 'scripts' });
  for (const file of [
    'ci.mjs',
    'ci/runner.mjs',
    'ci/range.mjs',
    'ci/event-range.mjs',
    'ci/cache.mjs',
    'ci/fetch.mjs',
  ]) {
    repo.write(`scripts/${file}`, '');
    copyFileSync(new URL(`../${file}`, import.meta.url), join(repo.root, 'scripts', file));
  }
  repo.write(
    'scripts/ci/gates.json',
    JSON.stringify({
      ...CONFIG,
      gates: [
        {
          name: 'environment',
          group: 'quality',
          command: 'node',
          args: [
            '-e',
            "require('node:fs').writeFileSync('environment.txt', require('node:path').relative(process.cwd(), process.env.MONGOMS_DOWNLOAD_DIR) + ':' + process.env.MONGOMS_DISABLE_POSTINSTALL)",
          ],
        },
      ],
    }),
  );
  const result = spawnSync(process.execPath, ['scripts/ci.mjs', '--quality'], {
    cwd: repo.root,
    env: repo.env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(readFileSync(join(repo.root, 'environment.txt'), 'utf8'), '.mongodb-binaries:1');
});
