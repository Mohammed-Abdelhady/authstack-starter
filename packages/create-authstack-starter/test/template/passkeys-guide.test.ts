import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseMarkerIds } from '../../src/manifest/dimensions.js';
import { loadManifest } from '../../src/manifest/load.js';
import { stripDocMarkers } from '../../src/prune/doc-markers.js';
import { REPO_ROOT } from '../support/combination-helpers.js';

const GUIDE = 'docs/setup/setup-passkeys.md';
const NATIVE_ROUTES = '/api/auth/native/passkeys';
const MOBILE_GUIDE = 'setup-mobile-sign-in.md';

const manifest = await loadManifest(REPO_ROOT);
const guide = readFileSync(join(REPO_ROOT, GUIDE), 'utf8');
const known = new Set([
  ...Object.keys(manifest.features),
  ...Object.keys(manifest.options),
  ...Object.keys(manifest.targets),
  ...Object.keys(manifest.shared),
  ...databaseMarkerIds(manifest),
]);

/** Everything selected except the mobile clients and what only they bring. */
const WITHOUT_MOBILE = new Set(
  [...known].filter((id) => !(id in manifest.targets) && !(id in manifest.shared)),
);

const generated = (kept: Set<string>): string => stripDocMarkers(guide, GUIDE, kept, known).content;

describe('the passkeys guide', () => {
  it('ships with passkeys whichever clients are picked', () => {
    expect(manifest.features.passkeys?.docs).toContain(GUIDE);
    expect(WITHOUT_MOBILE.has('passkeys')).toBe(true);
  });

  it('names no native route and links no mobile guide in a project without a mobile client', () => {
    const content = generated(WITHOUT_MOBILE);

    expect(content).toContain('/api/auth/passkeys');
    expect(content).not.toContain(NATIVE_ROUTES);
    expect(content).not.toContain(MOBILE_GUIDE);
  });

  it('keeps the native routes and the mobile guide link with a mobile client', () => {
    const content = generated(known);

    expect(content).toContain(NATIVE_ROUTES);
    expect(content).toContain(MOBILE_GUIDE);
  });
});
