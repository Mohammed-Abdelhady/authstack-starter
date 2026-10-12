import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateChanges, isCappedPath } from '../../check-hard-bans.mjs';

const CAPPED = [
  'packages/create-nest-next-auth/src/cli.ts',
  'packages/create-nest-next-auth/test/plan/plan.test.ts',
  'packages/create-nest-next-auth/scripts/sync-template.mjs',
  'scripts/init.js',
  'scripts/lib/cli-utils.js',
  'scripts/ci/runner.mjs',
  'scripts/config-transforms-tests/config-transforms.test.mjs',
  'scripts/guardrails/git/push.mjs',
  'backend/src/main.ts',
  'backend/test/app.e2e-spec.ts',
  'backend/scripts/seed.ts',
  'backend/migrations/20240101000000-init.js',
];

const UNCAPPED = [
  'packages/create-nest-next-auth/docs/add-rules.md',
  'packages/create-nest-next-auth/template/scripts/init.js',
  'packages/create-nest-next-auth/testing/helper.ts',
  'packages/create-nest-next-auth/tsdown.config.ts',
  'scripts/ci/gates.json',
  'scripts-archive/init.js',
  'docs/scripts/init.js',
  'backend/scripts-old/seed.ts',
  'backend/migrations-archive/init.js',
  'backend/jest.config.ts',
  'shared/core/scripts/generate.ts',
];

function lineCount(path, lines) {
  return evaluateChanges({ added: [], lineCounts: [{ path, lines }] });
}

for (const path of CAPPED) {
  test(`the line cap covers ${path}`, () => {
    assert.equal(isCappedPath(path), true);
    assert.deepEqual(lineCount(path, 350), { bans: [], caps: [], ok: true });
    assert.deepEqual(lineCount(path, 351), { bans: [], caps: [{ path, lines: 351 }], ok: false });
  });
}

for (const path of UNCAPPED) {
  test(`the line cap leaves ${path} alone`, () => {
    assert.equal(isCappedPath(path), false);
    assert.deepEqual(lineCount(path, 351), { bans: [], caps: [], ok: true });
  });
}
