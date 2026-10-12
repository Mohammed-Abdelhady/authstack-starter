import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hardcodedStringViolations, scanHardcodedStrings } from './hardcoded-strings-policy.mjs';

const FOUND = (source) => hardcodedStringViolations(source, 'a.tsx');

test('rejects visible text, expression children and fallback strings', () => {
  assert.deepEqual(FOUND('<p>Hello</p>'), [{ file: 'a.tsx', line: 1, kind: 'text' }]);
  assert.deepEqual(FOUND('<p>{"Hello"}</p>'), [{ file: 'a.tsx', line: 1, kind: 'expression' }]);
  assert.deepEqual(FOUND('<p>{ok ? t("yes") : "No"}</p>'), [
    { file: 'a.tsx', line: 1, kind: 'expression' },
  ]);
});

test('rejects hardcoded portions of interpolated templates', () => {
  assert.deepEqual(FOUND('<button aria-label={`Delete ${name}`}>{`Hello ${name}`}</button>'), [
    { file: 'a.tsx', line: 1, kind: 'attribute' },
    { file: 'a.tsx', line: 1, kind: 'expression' },
  ]);
  assert.deepEqual(FOUND('<p>{`${value} items`}</p>'), [
    { file: 'a.tsx', line: 1, kind: 'expression' },
  ]);
  assert.deepEqual(FOUND('<p>{`${"Hello"}`}</p>'), [
    { file: 'a.tsx', line: 1, kind: 'expression' },
  ]);
});

test('rejects native and component user-facing attributes in both forms', () => {
  for (const attribute of [
    'aria-label',
    'aria-description',
    'title',
    'placeholder',
    'alt',
    'label',
    'description',
    'subtitle',
    'loadingText',
    'emptyMessage',
  ]) {
    assert.deepEqual(FOUND(`<Input ${attribute}="Hello" />`), [
      { file: 'a.tsx', line: 1, kind: 'attribute' },
    ]);
    assert.deepEqual(FOUND(`<Input ${attribute}={value || 'Hello'} />`), [
      { file: 'a.tsx', line: 1, kind: 'attribute' },
    ]);
  }
});

test('rejects a literal password-mask placeholder', () => {
  assert.deepEqual(FOUND('<Input placeholder="********" />'), [
    { file: 'a.tsx', line: 1, kind: 'attribute' },
  ]);
});

test('accepts translated and dynamic text, empty text, comments and code', () => {
  assert.deepEqual(FOUND('<p title={t("title")}>{t("body")}{value}</p>'), []);
  assert.deepEqual(FOUND('<p title="">   {/* comment */}</p>'), []);
  assert.deepEqual(
    FOUND('// <p>Hello</p>\nconst x = <CodeBlock>{`const value = 1;`}</CodeBlock>;'),
    [],
  );
});

test('scans nested source files and excludes test fixtures', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'strings-policy-'));
  t.after(() => rmSync(root, { recursive: true }));
  assert.deepEqual(scanHardcodedStrings(root), []);
  mkdirSync(join(root, 'frontend/src/modules/a/__tests__'), { recursive: true });
  writeFileSync(join(root, 'frontend/src/modules/a/A.tsx'), '<p>Hello</p>');
  writeFileSync(join(root, 'frontend/src/modules/a/A.test.tsx'), '<p>Fixture</p>');
  writeFileSync(join(root, 'frontend/src/modules/a/__tests__/fixture.tsx'), '<p>Fixture</p>');
  assert.deepEqual(scanHardcodedStrings(root), [
    { file: 'frontend/src/modules/a/A.tsx', line: 1, kind: 'text' },
  ]);
});

test('all production source strings use catalogues', () => {
  assert.deepEqual(scanHardcodedStrings(new URL('..', import.meta.url).pathname), []);
});
