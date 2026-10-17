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
  const source = 'node_modules/\nAGENTS.md\nCLAUDE.md\noutput/\n';
  writeFileSync(join(fixture, '.gitignore'), source, 'utf8');
  trackAll(fixture);
  runScript(fixture);

  const shipped = readFileSync(
    join(fixture, 'packages/create-authstack-starter/template/_gitignore'),
    'utf8',
  );
  expect(shipped).toBe('node_modules/\noutput/\n');
});
