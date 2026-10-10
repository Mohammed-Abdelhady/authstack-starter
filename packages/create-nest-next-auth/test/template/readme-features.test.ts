import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseMarkerIds } from '../../src/manifest/dimensions.js';
import { loadManifest } from '../../src/manifest/load.js';
import { stripDocMarkers } from '../../src/prune/doc-markers.js';
import { REPO_ROOT } from '../support/combination-helpers.js';

const manifest = await loadManifest(REPO_ROOT);
const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const features = Object.entries(manifest.features).filter(
  ([, feature]) => feature.status !== 'planned',
);
const known = new Set([
  ...Object.keys(manifest.features),
  ...Object.keys(manifest.options),
  ...Object.keys(manifest.targets),
  ...Object.keys(manifest.shared),
  ...databaseMarkerIds(manifest),
]);

function generated(kept: Set<string>): string {
  return stripDocMarkers(readme, 'README.md', kept, known).content;
}

function namesVariable(content: string, variable: string): boolean {
  return new RegExp(`\\b${variable}\\b`).test(content);
}

describe('README optional feature ownership', () => {
  for (const [id, feature] of features) {
    it(`omits ${id} settings and table links when no owner remains`, () => {
      const kept = new Set(known);
      kept.delete(id);
      for (const variable of feature.envVars) {
        for (const [owner, entry] of features) {
          if (entry.envVars.includes(variable)) kept.delete(owner);
        }
      }
      const content = generated(kept);
      expect(feature.envVars.filter((variable) => namesVariable(content, variable))).toEqual([]);
      const tables = content
        .split('\n')
        .filter((line) => line.startsWith('|'))
        .join('\n');
      expect(feature.docs.filter((doc) => tables.includes(`](${doc})`))).toEqual([]);
    });
  }

  it('documents every manifest setting when everything is selected', () => {
    const content = generated(known);
    expect(
      features
        .flatMap(([, feature]) => feature.envVars)
        .filter((variable) => !namesVariable(content, variable)),
    ).toEqual([]);
  });

  it('preserves shared settings for each remaining owner', () => {
    const shared = features
      .flatMap(([, feature]) => feature.envVars)
      .filter((variable, index, all) => all.indexOf(variable) !== index);
    for (const variable of new Set(shared)) {
      for (const [id, feature] of features) {
        if (feature.envVars.includes(variable)) {
          expect(namesVariable(generated(new Set([id])), variable)).toBe(true);
        }
      }
    }
  });

  it('removes optional documentation table pages when all options are off', () => {
    const kept = new Set(known);
    for (const id of Object.keys(manifest.options)) kept.delete(id);
    const tables = generated(kept)
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .join('\n');
    expect(
      Object.values(manifest.options)
        .flatMap((option) => option.docs)
        .filter((doc) => tables.includes(`](${doc})`)),
    ).toEqual([]);
  });
});
