import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { checkPackageManager } from '../../check-package-manager.mjs';
import { repository } from '../test-repository.mjs';

const OLD_MANAGER = 'n' + 'pm';

test('tracked inventory scrubs hook Git variables and ignores deleted, untracked and protected files', (t) => {
  const fixture = repository(t);
  fixture.write('README.md', `heading\n${OLD_MANAGER} ci\n`);
  fixture.write('removed.md', `${OLD_MANAGER} ci`);
  fixture.write('.env.synthetic', `${OLD_MANAGER} ci`);
  fixture.write('binary.bin', Buffer.from([0, 1, 2]));
  fixture.git('add', '.');
  rmSync(join(fixture.root, 'removed.md'));
  fixture.write('untracked.md', `${OLD_MANAGER} ci`);
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = join(fixture.root, 'missing-repository');
  try {
    assert.deepEqual(checkPackageManager(fixture.root), [
      { file: 'README.md', line: 2, reference: `${OLD_MANAGER} ci` },
    ]);
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
  }
});

test('tracked inventory scans GitHub workflow files', (t) => {
  const fixture = repository(t);
  fixture.write('.github/workflows/ci.yml', `run: ${OLD_MANAGER} ci\n`);
  fixture.git('add', '.');

  assert.deepEqual(checkPackageManager(fixture.root), [
    {
      file: '.github/workflows/ci.yml',
      line: 1,
      reference: `${OLD_MANAGER} ci`,
    },
  ]);
});

test('non-Git scaffolds scan text and UTF-16 while refusing symlink traversal', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'manager-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'build' } }));
  writeFileSync(join(root, 'README.md'), `pnpm run build\n`);
  writeFileSync(
    join(root, 'encoded.md'),
    Buffer.concat([Buffer.from([255, 254]), Buffer.from(`${OLD_MANAGER} ci`, 'utf16le')]),
  );
  symlinkSync(join(root, 'encoded.md'), join(root, 'link.md'));
  assert.deepEqual(checkPackageManager(root), [
    { file: 'encoded.md', line: 1, reference: `${OLD_MANAGER} ci` },
  ]);
});
