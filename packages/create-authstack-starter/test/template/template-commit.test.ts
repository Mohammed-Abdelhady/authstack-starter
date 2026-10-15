import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { templateCommit } from '../../scripts/template-commit.mjs';
import { fixtureGit } from '../support/sync-template-fixture.js';

const roots: string[] = [];
const COMMIT_IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com'];
const SOURCE = 'source.txt';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function committedRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'cna-template-commit-'));
  roots.push(root);
  writeFileSync(join(root, SOURCE), 'committed\n');
  fixtureGit(root, ['init', '--quiet']);
  fixtureGit(root, ['add', SOURCE]);
  fixtureGit(root, [...COMMIT_IDENTITY, 'commit', '--quiet', '-m', 'fixture']);
  return root;
}

function everySource(): boolean {
  return true;
}

// Catches a recorded commit for template bytes that commit does not hold.
it('records HEAD for a clean tree and null for an edit hidden by assume-unchanged', () => {
  const clean = committedRepository();
  const hidden = committedRepository();
  fixtureGit(hidden, ['update-index', '--assume-unchanged', SOURCE]);
  writeFileSync(join(hidden, SOURCE), 'edited\n');

  expect({
    diffSeesEdit: fixtureGit(hidden, ['diff', '--name-only', 'HEAD']) !== '',
    clean: templateCommit(fixtureGit, clean, everySource),
    hidden: templateCommit(fixtureGit, hidden, everySource),
  }).toEqual({
    diffSeesEdit: false,
    clean: fixtureGit(clean, ['rev-parse', 'HEAD']).trim(),
    hidden: null,
  });
});
