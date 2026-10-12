import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { templateContent } from '../../scripts/sync-template.mjs';
import { isRecord } from '../../src/manifest/read.js';
import { newFixture, runScript, trackAll } from '../support/sync-template-fixture.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function lockfileDocuments(source: string): unknown[] {
  return parseAllDocuments(source).map((document) => document.toJS());
}

it('ships the lockfile without the installer workspace importer', () => {
  const source = readFileSync(join(REPOSITORY_ROOT, 'pnpm-lock.yaml'));
  const shipped = templateContent('pnpm-lock.yaml', source).toString();
  const before = lockfileDocuments(source.toString());
  const after = lockfileDocuments(shipped);
  const originalProjectLock = before[1];
  const templateProjectLock = after[1];

  if (!isRecord(originalProjectLock) || !isRecord(templateProjectLock)) {
    throw new Error('The project lockfile document is missing.');
  }
  if (!isRecord(originalProjectLock.importers) || !isRecord(templateProjectLock.importers)) {
    throw new Error('The project lockfile importers are missing.');
  }
  expect(Object.keys(templateProjectLock.importers).sort()).toEqual([
    '.',
    'backend',
    'frontend',
    'mobile/adapters',
    'mobile/auth',
    'mobile/cli',
    'mobile/device-key',
    'mobile/expo',
    'mobile/metro',
    'mobile/ui',
    'shared/core',
    'shared/sdk',
  ]);
  expect(templateProjectLock.packages).toEqual(originalProjectLock.packages);
  expect(templateProjectLock.snapshots).toEqual(originalProjectLock.snapshots);
  expect(after[0]).toEqual(before[0]);
});

it('ships the project ignore list without only the instruction-file entries', () => {
  const fixture = newFixture(roots);
  const source = readFileSync(join(REPOSITORY_ROOT, '.gitignore'), 'utf8');
  const removed = source.split('\n').filter((line) => line === 'AGENTS.md' || line === 'CLAUDE.md');
  writeFileSync(join(fixture, '.gitignore'), source, 'utf8');
  trackAll(fixture);
  runScript(fixture);

  const shipped = readFileSync(
    join(fixture, 'packages/create-nest-next-auth/template/_gitignore'),
    'utf8',
  );
  const expected = source
    .split('\n')
    .filter((line) => line !== 'AGENTS.md' && line !== 'CLAUDE.md')
    .join('\n');

  expect(removed).toEqual(['AGENTS.md', 'CLAUDE.md']);
  expect(shipped).toBe(expected);
});

it('ships the mobile commit scope with the marker that lets a project drop it', () => {
  const source = readFileSync(join(REPOSITORY_ROOT, 'commitlint.config.cjs'), 'utf8');
  const shipped = templateContent('commitlint.config.cjs', Buffer.from(source)).toString();

  expect(shipped).toBe(source);
  expect(shipped.split('\n')).toContain("        'mobile', // feature:native-core");
});

it('keeps repository cloning instructions out of the generated quick start', () => {
  const source = readFileSync(join(REPOSITORY_ROOT, 'README.md'));
  const shipped = templateContent('README.md', source).toString();
  expect({
    repositoryClone: source.toString().includes('git clone '),
    generatedClone: shipped.includes('git clone '),
    frozenInstall: shipped.includes('pnpm install --frozen-lockfile'),
    projectInstall: shipped.includes('pnpm install\n'),
  }).toEqual({
    repositoryClone: true,
    generatedClone: false,
    frozenInstall: false,
    projectInstall: true,
  });
});
