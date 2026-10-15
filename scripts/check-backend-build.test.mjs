import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-backend-build.mjs', import.meta.url));
const PRODUCTION_MAP = '{"version":3,"sources":["../src/main.ts"],"mappings":""}';

function buildOutput(t, files = { 'main.js': 'exports.start = () => {};\n' }) {
  const root = mkdtempSync(join(tmpdir(), 'backend-build-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  mkdirSync(dist);
  const output = { ...files };
  if ('main.js' in files) output['cli/audience-apply.js'] = 'exports.main = () => {};\n';
  for (const [name, content] of Object.entries(output)) {
    const target = join(dist, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dist;
}

function check(dist) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [SCRIPT, dist], {
    cwd: dirname(dist),
    encoding: 'utf8',
  });
  return { status, stdout, stderr };
}

function rejects(dist) {
  const result = check(dist);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^[^\r\n]+\n$/);
}

test('accepts production JavaScript', (t) => {
  assert.deepEqual(check(buildOutput(t)), { status: 0, stdout: '', stderr: '' });
});

// Failure: the image ships without its operator migration entry point.
test('rejects a missing compiled audience command', (t) => {
  const dist = buildOutput(t);
  rmSync(join(dist, 'cli/audience-apply.js'));
  rejects(dist);
});

test('accepts production declarations and source maps', (t) => {
  const dist = buildOutput(t, {
    'main.js': 'exports.start = () => {};\n//# sourceMappingURL=main.js.map\n',
    'main.d.ts': 'export declare function start(): void;\n',
    'main.js.map': PRODUCTION_MAP,
    'auth/service.js': 'exports.ready = true;\n',
    'auth/service.d.ts': 'export declare const ready: boolean;\n',
  });
  assert.deepEqual(check(dist), { status: 0, stdout: '', stderr: '' });
});

for (const layout of ['absent dist', 'empty dist', 'nested main', 'main directory']) {
  test(`rejects ${layout}`, (t) => {
    const dist = buildOutput(t, layout === 'nested main' ? { 'src/main.js': '' } : {});
    if (layout === 'absent dist') rmSync(dist, { recursive: true });
    if (layout === 'main directory') mkdirSync(join(dist, 'main.js'));
    rejects(dist);
  });
}

for (const directory of ['test', 'nested/test', '__tests__']) {
  test(`rejects an empty ${directory} directory`, (t) => {
    const dist = buildOutput(t);
    mkdirSync(join(dist, directory), { recursive: true });
    rejects(dist);
  });
}

for (const artifact of [
  'auth/service.spec.js',
  'native/harness/native-oauth.harness-spec.js',
  'nested/session.fixture.js',
  'nested/service.mock.js',
  'auth/service.e2e-spec.d.ts',
  'auth/service.harness-spec.js.map',
]) {
  test(`rejects emitted ${artifact}`, (t) => {
    rejects(
      buildOutput(t, {
        'main.js': '',
        [artifact]: artifact.endsWith('.map') ? PRODUCTION_MAP : '',
      }),
    );
  });
}

for (const source of ['../../test/utils/helper.ts', '../src/auth/service.fixture.ts']) {
  test(`rejects a source map originating from ${source}`, (t) => {
    rejects(
      buildOutput(t, {
        'main.js': '',
        'service.js.map': JSON.stringify({ version: 3, sources: [source], mappings: '' }),
      }),
    );
  });
}

for (const [name, content] of [
  ['jest.js', 'jest.fn();'],
  ['global.js', 'globalThis.jest.fn();'],
  ['bare.js', 'exports.runner = jest;'],
  ['types.d.ts', 'export declare const mock: jest.Mock;'],
  ['testing.js', 'const testing = require("@nestjs/testing");'],
  ['testing-spaces.js', "const testing = require ( '@nestjs/testing' );"],
]) {
  test(`rejects a test dependency in ${name}`, (t) => {
    rejects(buildOutput(t, { 'main.js': '', [name]: content }));
  });
}
