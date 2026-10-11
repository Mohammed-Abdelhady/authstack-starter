import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MANIFEST_FILE, REWRITES_FILE } from '../../src/constants/index.js';
import { loadManifest, mergeRewrites } from '../../src/manifest/load.js';
import { isRecord } from '../../src/manifest/read.js';
import { REPO_ROOT } from '../support/answers-helpers.js';

const MANIFEST = {
  version: 2,
  features: {},
  targets: { web: { label: 'Web', default: true } },
  databases: {
    first: { label: 'First', default: true },
    second: {
      label: 'Second',
      default: false,
      rewrites: [{ files: ['a.md'], from: 'inline', to: 'kept first' }],
    },
  },
  core: { alwaysRemoveFiles: [] },
};

const roots: string[] = [];

async function rootWith(rewrites?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-rewrites-'));
  roots.push(root);
  await writeFile(join(root, MANIFEST_FILE), JSON.stringify(MANIFEST));
  if (rewrites !== undefined) await writeFile(join(root, REWRITES_FILE), rewrites);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('the rewrites file beside the manifest', () => {
  it('adds each database its rewrites, after the ones the manifest holds', async () => {
    const root = await rootWith(
      JSON.stringify({
        $comment: 'not a database',
        first: [{ files: ['b.md'], from: 'one', to: 'two' }],
        second: [{ files: ['a.md'], from: 'from the file', to: 'second' }],
      }),
    );

    const manifest = await loadManifest(root);

    expect({
      first: manifest.databases.first.rewrites,
      second: manifest.databases.second.rewrites,
    }).toEqual({
      first: [{ files: ['b.md'], from: 'one', to: 'two' }],
      second: [
        { files: ['a.md'], from: 'inline', to: 'kept first' },
        { files: ['a.md'], from: 'from the file', to: 'second' },
      ],
    });
  });

  it('is optional: a manifest alone loads with what it holds', async () => {
    const manifest = await loadManifest(await rootWith());

    expect({
      first: manifest.databases.first.rewrites,
      second: manifest.databases.second.rewrites,
    }).toEqual({ first: [], second: [{ files: ['a.md'], from: 'inline', to: 'kept first' }] });
  });

  it.each([
    [
      'a key that is no database of the manifest',
      { third: [] },
      'template.rewrites.json names "third", which is not a database of the manifest',
    ],
    [
      'a database whose entry is not a list',
      { second: { files: [] } },
      'template.rewrites.json.second must be an array',
    ],
    ['a file that is not an object', ['second'], 'template.rewrites.json must be an object'],
  ])('refuses %s', (_, rewrites, problem) => {
    expect(() => mergeRewrites(MANIFEST, rewrites)).toThrow(problem);
  });

  it('checks a rewrite of the file as it checks one of the manifest', async () => {
    const root = await rootWith(JSON.stringify({ second: [{ files: ['a.md'], to: 'no text' }] }));

    await expect(loadManifest(root)).rejects.toThrow(/databases\.second\.rewrites\[1\]\.from/);
  });

  it('names the file when it is not JSON', async () => {
    const root = await rootWith('{ not json');

    await expect(loadManifest(root)).rejects.toThrow(
      `Could not parse ${join(root, REWRITES_FILE)}`,
    );
  });

  it('is where this repository keeps the rewrites of PostgreSQL', async () => {
    const alone: unknown = JSON.parse(await readFile(join(REPO_ROOT, MANIFEST_FILE), 'utf8'));
    const databases = isRecord(alone) && isRecord(alone.databases) ? alone.databases : {};
    const inline = Object.values(databases).filter(
      (database) => isRecord(database) && database.rewrites !== undefined,
    );
    const manifest = await loadManifest(REPO_ROOT);

    expect({
      inline: inline.length,
      postgres: manifest.databases.postgres.rewrites.length > 100,
      // A MongoDB project with everything on is this repository less its markers.
      mongodb: manifest.databases.mongodb.rewrites,
    }).toEqual({ inline: 0, postgres: true, mongodb: [] });
  });
});
