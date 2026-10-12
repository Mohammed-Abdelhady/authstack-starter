import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { matchesAnyGlob } from '../../packages/create-nest-next-auth/scripts/glob.mjs';
import { loadControlPairs, loadCss, loadTintedPairs, parseTokens } from '../check-contrast.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'template.manifest.json'), 'utf8'));
const GATES = JSON.parse(fs.readFileSync(new URL('./gates.json', import.meta.url), 'utf8'));
const GATE = 'Colour contrast';

/** Every text the manifest holds, so a path counts whatever owns it: a feature, an option, a database or a target. */
function manifestPaths(value) {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return [...Object.keys(value), ...Object.values(value)].flatMap(manifestPaths);
}

/** The repository files the audit opens, recorded while its three loaders run. */
function filesRead(t) {
  const real = fs.readFileSync;
  const opened = new Set();
  t.mock.method(fs, 'readFileSync', (file, ...rest) => {
    opened.add(path.relative(ROOT, String(file)).split(path.sep).join('/'));
    return real(file, ...rest);
  });
  const known = Object.keys(parseTokens(loadCss()).light);
  loadControlPairs(known);
  loadTintedPairs(known);
  t.mock.restoreAll();
  return [...opened].sort();
}

test('the contrast audit is a quality gate that a generated project keeps', () => {
  assert.deepEqual(
    GATES.gates.filter((gate) => gate.name === GATE),
    [{ name: GATE, group: 'quality', command: 'node', args: ['scripts/check-contrast.mjs'] }],
  );
});

test('the contrast audit opens only files that no choice of options removes', (t) => {
  const opened = filesRead(t);
  const owned = manifestPaths(MANIFEST);

  assert.deepEqual(opened.slice(0, 2), [
    'frontend/src/app/globals.css',
    'frontend/src/app/tokens.css',
  ]);
  assert.ok(opened.length >= 7, `only ${opened.length} files were recorded`);
  assert.deepEqual(
    opened.filter((file) => file.startsWith('..') || matchesAnyGlob(file, owned)),
    [],
  );
});

test('a file under a folder an option owns is told apart from one every project keeps', () => {
  const owned = manifestPaths(MANIFEST);

  assert.equal(matchesAnyGlob('frontend/src/modules/passkeys/components/PasskeyRow.tsx', owned), true);
  assert.equal(matchesAnyGlob('scripts/check-contrast.mjs', owned), false);
  assert.equal(matchesAnyGlob('template.manifest.json', owned), true);
});
