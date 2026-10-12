import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { checkPackageManager, legacyReferences } from '../../check-package-manager.mjs';
import { repository } from '../test-repository.mjs';

const OLD_MANAGER = 'n' + 'pm';
const OLD_EXEC = 'np' + 'x';
const OLD_LOCK = 'package' + '-lock';
const OLD_YARN = 'y' + 'arn';
const OLD_BUN = 'b' + 'un';
const OLD_BUN_EXEC = OLD_BUN + 'x';

const LEGACY_COMMANDS = [
  [`${OLD_MANAGER} run build`, `${OLD_MANAGER} run`],
  [`${OLD_MANAGER} ci`, `${OLD_MANAGER} ci`],
  [`${OLD_MANAGER} install`, `${OLD_MANAGER} install`],
  [`${OLD_MANAGER} test`, `${OLD_MANAGER} test`],
  [`${OLD_MANAGER} start`, `${OLD_MANAGER} start`],
  [`${OLD_MANAGER} i`, `${OLD_MANAGER} i`],
  [`${OLD_MANAGER} exec eslint`, `${OLD_MANAGER} exec`],
  [`${OLD_MANAGER} audit`, `${OLD_MANAGER} audit`],
  [`${OLD_MANAGER} update`, `${OLD_MANAGER} update`],
  [`${OLD_MANAGER} add package`, `${OLD_MANAGER} add`],
  [`${OLD_MANAGER} remove package`, `${OLD_MANAGER} remove`],
  [`${OLD_MANAGER} uninstall package`, `${OLD_MANAGER} uninstall`],
  [`${OLD_MANAGER} rebuild package`, `${OLD_MANAGER} rebuild`],
  [`${OLD_MANAGER} link package`, `${OLD_MANAGER} link`],
  [`${OLD_MANAGER} dedupe`, `${OLD_MANAGER} dedupe`],
  [`${OLD_MANAGER} prune`, `${OLD_MANAGER} prune`],
  [`${OLD_YARN} add package`, `${OLD_YARN} add`],
  [`${OLD_YARN} install`, `${OLD_YARN} install`],
  [`${OLD_YARN} run build`, `${OLD_YARN} run`],
  [`${OLD_YARN} dev`, `${OLD_YARN} dev`],
  [`${OLD_BUN_EXEC} eslint`, OLD_BUN_EXEC],
  [`${OLD_BUN} install`, `${OLD_BUN} install`],
  [`${OLD_BUN} run build`, `${OLD_BUN} run`],
];

for (const [command, reference] of LEGACY_COMMANDS) {
  test(`inventory rejects ${reference}`, () => {
    assert.deepEqual(legacyReferences('docs/setup.md', `heading\n${command}\n`), [
      { file: 'docs/setup.md', line: 2, reference },
    ]);
  });
}

test('inventory rejects the legacy executable and lock references', () => {
  assert.deepEqual(legacyReferences('.husky/pre-commit', `${OLD_EXEC} eslint`), [
    { file: '.husky/pre-commit', line: 1, reference: OLD_EXEC },
  ]);
  assert.deepEqual(legacyReferences('Dockerfile', `COPY ${OLD_LOCK}.json ./`), [
    { file: 'Dockerfile', line: 1, reference: OLD_LOCK },
  ]);
  assert.deepEqual(legacyReferences(`${OLD_LOCK}.json`, '{}'), [
    { file: `${OLD_LOCK}.json`, line: 1, reference: OLD_LOCK },
  ]);
});

test('inventory accepts pnpm, registry prose and publication commands', () => {
  assert.deepEqual(
    legacyReferences(
      'README.md',
      'pnpm run build\npnpm install --frozen-lockfile\npnpm exec eslint\n',
    ),
    [],
  );
  for (const phrase of [
    `the ${OLD_MANAGER} registry`,
    `${OLD_MANAGER} pack`,
    `${OLD_MANAGER} publish`,
  ]) {
    assert.deepEqual(legacyReferences('docs/setup.md', phrase), []);
  }
});

test('publication and changelog exemptions remain narrow', () => {
  assert.deepEqual(
    legacyReferences('packages/create-nest-next-auth/test/packed/packed-cli.ts', `${OLD_MANAGER} install`),
    [],
  );
  assert.deepEqual(legacyReferences('.gitignore', `${OLD_LOCK}.json\n`), []);
  assert.deepEqual(legacyReferences('CHANGELOG.md', `${OLD_MANAGER} ci`), []);
  assert.deepEqual(
    legacyReferences('packages/create-nest-next-auth/src/cli.ts', `${OLD_MANAGER} run build`),
    [
      {
        file: 'packages/create-nest-next-auth/src/cli.ts',
        line: 1,
        reference: `${OLD_MANAGER} run`,
      },
    ],
  );
});

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

test('inventory catches documented pnpm scripts missing from every workspace manifest', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'manager-scripts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'lint' } }));
  mkdirSync(join(root, 'backend'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(
    join(root, 'backend/package.json'),
    JSON.stringify({ scripts: { seed: 'seed' } }),
  );
  mkdirSync(join(root, 'empty'), { recursive: true });
  writeFileSync(join(root, 'empty/package.json'), JSON.stringify({ scripts: null }));
  writeFileSync(
    join(root, 'docs/commands.md'),
    'pnpm run lint\npnpm --filter backend run seed\npnpm run migration:run add-permissions\npnpm exec eslint\npnpm run <script>\n',
  );

  assert.deepEqual(checkPackageManager(root), [
    {
      file: 'docs/commands.md',
      line: 3,
      reference: 'migration:run',
      kind: 'missing-script',
    },
  ]);
});
