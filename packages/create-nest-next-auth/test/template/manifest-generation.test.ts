import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { manifestPathProblems } from '../../src/manifest/validate-paths.js';
import { describePlanErrors } from '../../src/report/summary.js';
import { matchesAnyGlob } from '../../src/utils/glob.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

it('names only tracked files and workspaces in every glob', async () => {
  const manifest = await loadManifest(REPO_ROOT);

  expect(manifestPathProblems(manifest, trackedFiles())).toEqual([]);
});

it('gives every mobile workspace exactly one owner', async () => {
  const manifest = await loadManifest(REPO_ROOT);
  const owners = [
    ...Object.entries(manifest.targets).map(([id, target]) => ({ id, files: target.files })),
    ...Object.entries(manifest.shared).map(([id, shared]) => ({ id, files: shared.files })),
  ];
  const workspaces = trackedFiles().filter((file) => /^mobile\/[^/]+\/package\.json$/.test(file));

  const owned = Object.fromEntries(
    workspaces.map((file) => [
      file,
      owners.filter((owner) => matchesAnyGlob(file, owner.files)).map((owner) => owner.id),
    ]),
  );

  expect(owned).toEqual({
    'mobile/adapters/package.json': ['native-core'],
    'mobile/auth/package.json': ['native-core'],
    'mobile/cli/package.json': ['native-cli'],
    'mobile/device-key/package.json': ['native-core'],
    'mobile/expo/package.json': ['native-expo'],
    'mobile/metro/package.json': ['native-core'],
    'mobile/ui/package.json': ['native-core'],
  });
});

it('leaves no tracked mobile file without an owner', async () => {
  const manifest = await loadManifest(REPO_ROOT);
  const owned = [
    ...Object.values(manifest.targets).flatMap((target) => target.files),
    ...Object.values(manifest.shared).flatMap((shared) => shared.files),
  ];
  const mobile = trackedFiles().filter((file) => file.startsWith('mobile/'));

  expect(mobile.length).toBeGreaterThan(300);
  expect(mobile.filter((file) => !matchesAnyGlob(file, owned))).toEqual([]);
});

it('keeps the mobile folder out of the list every project loses', async () => {
  const manifest = await loadManifest(REPO_ROOT);

  expect(manifest.core.alwaysRemoveFiles.filter((glob) => glob.startsWith('mobile'))).toEqual([]);
});

it('keeps the suites that drive the engine against the real server in this repository', async () => {
  const manifest = await loadManifest(REPO_ROOT);
  const repositoryOnly = trackedFiles().filter(
    (file) =>
      /^backend\/test\/(native\/engine\/native-auth-engine|utils\/native\/native-auth-engine)/.test(
        file,
      ) && matchesAnyGlob(file, manifest.core.alwaysRemoveFiles),
  );

  expect(repositoryOnly).toEqual([
    'backend/test/native/engine/native-auth-engine-consent.e2e-spec.ts',
    'backend/test/native/engine/native-auth-engine-dpop-challenge.e2e-spec.ts',
    'backend/test/native/engine/native-auth-engine-dpop-retry.e2e-spec.ts',
    'backend/test/native/engine/native-auth-engine-dpop.e2e-spec.ts',
    'backend/test/native/engine/native-auth-engine.e2e-spec.ts',
    'backend/test/utils/native/native-auth-engine-consent.ts',
    'backend/test/utils/native/native-auth-engine-dpop-support.ts',
    'backend/test/utils/native/native-auth-engine-harness.ts',
  ]);
});

it('offers the Expo app and resolves what it needs', async () => {
  const manifest = await loadManifest(REPO_ROOT);
  const plan = resolvePlan(manifest, { targets: ['native-expo'], projectName: 'field-notes' });

  expect({
    targets: plan.targets,
    shared: plan.shared,
    signInSite: plan.signInSite,
    errors: plan.errors,
  }).toEqual({
    targets: ['native-expo'],
    shared: ['native-core'],
    signInSite: 'kept-for-native',
    errors: [],
  });
});

it('adds the Expo app to the everything preset and to no other', async () => {
  const manifest = await loadManifest(REPO_ROOT);

  expect({
    everything: resolvePlan(manifest, { preset: 'everything' }).targets,
    standard: resolvePlan(manifest, { preset: 'standard' }).targets,
    minimal: resolvePlan(manifest, { preset: 'minimal' }).targets,
    none: resolvePlan(manifest, {}).targets,
  }).toEqual({
    everything: ['web', 'native-expo'],
    standard: ['web'],
    minimal: ['web'],
    none: ['web'],
  });
});

it('refuses the bare app, which has not run on a simulator', async () => {
  const manifest = await loadManifest(REPO_ROOT);
  const plan = resolvePlan(manifest, { targets: ['web', 'native-cli'] });

  expect(plan.targets).toEqual(['web']);
  expect(plan.errors).toEqual([{ id: 'native-cli', reason: 'planned' }]);
  expect(describePlanErrors(manifest, plan.errors)).toEqual(['"native-cli" is not available yet.']);
});

it('still loads a legacy generation manifest with the web default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manifest-legacy-'));
  try {
    const raw = JSON.parse(await readFile(join(REPO_ROOT, 'template.manifest.json'), 'utf8'));
    await writeFile(
      join(root, 'template.manifest.json'),
      JSON.stringify({ features: raw.features, core: raw.core }),
    );
    const manifest = await loadManifest(root);
    const plan = resolvePlan(manifest, {});
    expect({ targets: plan.targets, shared: plan.shared, errors: plan.errors }).toEqual({
      targets: ['web'],
      shared: [],
      errors: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
