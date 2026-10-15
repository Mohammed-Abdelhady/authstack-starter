import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveJestCli } from './run-jest-support.mjs';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIRECTORY = dirname(TEST_DIRECTORY);
const HOST_DIRECTORY = join(TEST_DIRECTORY, 'host');
const E2E_CONFIG_PATTERN = /^jest-e2e.*\.json$/;

function listedTests(config) {
  const jestCli = resolveJestCli(
    join(BACKEND_DIRECTORY, 'node_modules', 'jest', 'package.json'),
  );
  const result = spawnSync(
    process.execPath,
    [jestCli, '--config', join(TEST_DIRECTORY, config), '--listTests'],
    { cwd: BACKEND_DIRECTORY, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter(Boolean);
}

// Catches an e2e config that would silently skip the product's own specs.
test('each e2e config lists a spec placed in the host folder', (t) => {
  const configs = readdirSync(TEST_DIRECTORY)
    .filter((name) => E2E_CONFIG_PATTERN.test(name))
    .sort();
  const spec = join(
    HOST_DIRECTORY,
    `host-discovery-${process.pid}.e2e-spec.ts`,
  );
  writeFileSync(spec, "it('is listed', () => undefined);\n");
  t.after(() => rmSync(spec, { force: true }));
  const expected = realpathSync(spec);

  assert.notEqual(configs.length, 0);
  assert.deepEqual(
    configs.map((config) => [config, listedTests(config).includes(expected)]),
    configs.map((config) => [config, true]),
  );
});
