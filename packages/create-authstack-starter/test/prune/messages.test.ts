import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateManifest } from '../../src/manifest/validate.js';
import { pruneCatalogueKeys, pruneMessageCatalogues } from '../../src/prune/messages.js';

const CATALOGUE = 'frontend/src/i18n/messages/en.json';

const MANIFEST = validateManifest({
  version: 2,
  targets: {
    web: { label: 'Web', default: true, files: [], workspaces: [], envFiles: [] },
  },
  shared: {},
  databases: {
    mongodb: { label: 'MongoDB', default: true, files: [], envVars: [] },
  },
  options: {
    'locale-ar': {
      label: 'Arabic locale',
      default: true,
      files: [],
      requires: [],
      docs: [],
      catalogueKeys: [{ path: CATALOGUE, keys: ['common.switchToArabic'] }],
    },
  },
  presets: {},
  features: {
    a: {
      label: 'A',
      description: 'A.',
      kind: 'oauth',
      default: true,
      files: [],
      envVars: [],
      requires: [],
      docs: [],
    },
  },
  core: { alwaysRemoveFiles: [] },
});

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-messages-'));
  roots.push(root);
  return root;
}

async function writeCatalogue(root: string, content: string): Promise<void> {
  const path = join(root, CATALOGUE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('pruneCatalogueKeys', () => {
  it('removes the keys an option owns', () => {
    const result = pruneCatalogueKeys(
      { common: { switchToEnglish: 'English', switchToArabic: 'Arabic' } },
      ['common.switchToArabic'],
    );

    expect(result).toEqual({ common: { switchToEnglish: 'English' } });
  });
});

describe('pruneMessageCatalogues', () => {
  it('removes the manifest keys from the catalogue', async () => {
    const root = await tempRoot();
    await writeCatalogue(
      root,
      JSON.stringify({ common: { switchToEnglish: 'English', switchToArabic: 'Arabic' } }),
    );

    await expect(pruneMessageCatalogues(root, MANIFEST, ['locale-ar'])).resolves.toEqual([
      CATALOGUE,
    ]);
  });

  it('returns nothing for a missing catalogue', async () => {
    const root = await tempRoot();

    await expect(pruneMessageCatalogues(root, MANIFEST, ['locale-ar'])).resolves.toEqual([]);
  });

  it('rejects invalid JSON with the catalogue path', async () => {
    const root = await tempRoot();
    await writeCatalogue(root, '{ not json');

    await expect(pruneMessageCatalogues(root, MANIFEST, ['locale-ar'])).rejects.toThrow(
      /Could not parse frontend\/src\/i18n\/messages\/en\.json/,
    );
  });

  it('rejects a manifest key that is absent from the catalogue', async () => {
    const root = await tempRoot();
    await writeCatalogue(root, JSON.stringify({ common: { switchToEnglish: 'English' } }));

    await expect(pruneMessageCatalogues(root, MANIFEST, ['locale-ar'])).rejects.toThrow(
      /Catalogue key "common\.switchToArabic" is not in frontend\/src\/i18n\/messages\/en\.json/,
    );
  });
});
