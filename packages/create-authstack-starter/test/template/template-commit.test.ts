import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { isExcluded, trackedFiles } from '../../scripts/sync-template.mjs';
import { templateCommit } from '../../scripts/template-commit.mjs';
import { isExcludedPath, selectSources } from '../../scripts/template-sources.mjs';
import { fixtureGit } from '../support/sync-template-fixture.js';

const roots: string[] = [];
const COMMIT_IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com'];
const DIRECTORY = 'frontend';
const SOURCE = `${DIRECTORY}/page.txt`;
const COMMITTED = 'committed\n';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'cna-template-commit-'));
  roots.push(root);
  return root;
}

function committedRepository(): string {
  const root = temporaryDirectory();
  mkdirSync(join(root, DIRECTORY));
  writeFileSync(join(root, SOURCE), COMMITTED);
  fixtureGit(root, ['init', '--quiet']);
  fixtureGit(root, ['add', SOURCE]);
  fixtureGit(root, [...COMMIT_IDENTITY, 'commit', '--quiet', '-m', 'fixture']);
  return root;
}

function isTemplateSource(path: string): boolean {
  return !isExcludedPath(path.split('/'), isExcluded);
}

/** The commit the build records, from the set the copier's own selection picks. */
async function recordedCommit(root: string): Promise<string | null> {
  const selected = await selectSources(root, trackedFiles(root), isExcluded);
  const copied = selected.map(({ path, stats }) => ({
    path,
    mode: stats.mode,
    bytes: readFileSync(join(root, ...path.split('/'))),
  }));
  return templateCommit(fixtureGit, root, { copied, isTemplateSource });
}

function headOf(root: string): string {
  return fixtureGit(root, ['rev-parse', 'HEAD']).trim();
}

// Catches a recorded commit for template bytes that commit does not hold.
it('records HEAD for a clean tree and null for an edit hidden by assume-unchanged', async () => {
  const clean = committedRepository();
  const hidden = committedRepository();
  fixtureGit(hidden, ['update-index', '--assume-unchanged', SOURCE]);
  writeFileSync(join(hidden, SOURCE), 'edited\n');

  expect({
    diffSeesEdit: fixtureGit(hidden, ['diff', '--name-only', 'HEAD']) !== '',
    clean: await recordedCommit(clean),
    hidden: await recordedCommit(hidden),
  }).toEqual({ diffSeesEdit: false, clean: headOf(clean), hidden: null });
});

// Catches a recorded commit for a template the copier built without one of its files.
it.each([
  [
    'a source removed from the index with its bytes left on disk',
    (root: string): void => {
      fixtureGit(root, ['rm', '--cached', '--quiet', SOURCE]);
    },
  ],
  [
    'a directory replaced by a symlink to an identical copy',
    (root: string): void => {
      const elsewhere = join(temporaryDirectory(), DIRECTORY);
      renameSync(join(root, DIRECTORY), elsewhere);
      symlinkSync(elsewhere, join(root, DIRECTORY), 'dir');
    },
  ],
])('records null for %s', async (_label, leaveOut) => {
  const clean = committedRepository();
  const changed = committedRepository();
  leaveOut(changed);

  expect({
    bytesOnDisk: readFileSync(join(changed, SOURCE), 'utf8'),
    clean: await recordedCommit(clean),
    changed: await recordedCommit(changed),
  }).toEqual({ bytesOnDisk: COMMITTED, clean: headOf(clean), changed: null });
});
