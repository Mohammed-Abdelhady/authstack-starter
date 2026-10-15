import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { databaseMarkerIds, defaultDatabaseIds } from '../../src/manifest/dimensions.js';
import { loadManifest } from '../../src/manifest/load.js';
import { defaultOwnership } from '../../src/manifest/ownership.js';
import { availableFeatures, resolveSelection } from '../../src/manifest/select.js';
import type { Manifest } from '../../src/types.js';
import {
  buildCli,
  compareWithRepository,
  installProject,
  installFromWarmStore,
  REPO_ROOT,
  runBackendBoot,
  scaffold,
} from '../support/combination-helpers.js';
import {
  expectDriftMatches,
  expectLints,
  expectPrunedShared,
  expectTypechecks,
} from './combination-scenarios.js';
import { verifyFeatureAvailability } from './feature-runtime.js';

/**
 * Every feature combination a generated project has to compile in. Slow by
 * nature: it builds the CLI, scaffolds seven trees and runs three typechecks,
 * the drift spec, and a frontend check against the pruned shared package over
 * each. Run it with `pnpm --filter create-authstack-starter run test:combinations`.
 */

const ALL_OAUTH = [
  'google',
  'github',
  'facebook',
  'microsoft',
  'apple',
  'discord',
  'linkedin',
  'gitlab',
  'x',
  'slack',
  'twitch',
  'oidc',
];

interface Combination {
  name: string;
  features: string[];
}

const COMBINATIONS: Combination[] = [
  { name: 'email and password on its own', features: ['email-password'] },
  { name: 'magic link on its own', features: ['magic-link'] },
  { name: 'Google on its own', features: ['google'] },
  { name: 'email and password with Google', features: ['email-password', 'google'] },
  { name: 'email and password with TOTP', features: ['email-password', 'totp'] },
  { name: 'passkeys on their own', features: ['passkeys'] },
  { name: 'passkeys with Google and no TOTP', features: ['passkeys', 'google'] },
  {
    name: 'both second factors and every provider',
    features: ['email-password', 'totp', 'passkeys', ...ALL_OAUTH],
  },
];

let workspace = '';
let manifest: Manifest;
let built = { ok: false, output: '' };

/** Every feature the CLI can be asked for. Hidden ids arrive through `requires`. */
function everything(): string[] {
  return availableFeatures(manifest)
    .filter(({ feature }) => feature.kind !== 'hidden')
    .map(({ id }) => id);
}

beforeAll(async () => {
  workspace = mkdtempSync(join(inject('combinationRoot'), 'features-'));
  manifest = await loadManifest(REPO_ROOT);
  built = await buildCli();
});

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

/** Scaffolds one selection and returns where it landed. */
async function generate(name: string, features: string[]): Promise<string> {
  const project = join(workspace, name.replace(/\W+/g, '-'));
  const result = await scaffold(project, features);
  expect(result.ok, result.output).toBe(true);
  const install = await installProject(project, inject('pnpmStore'));
  expect(install.ok, install.output).toBe(true);
  const availability = verifyFeatureAvailability(project, features);
  expect(availability.ok, availability.output).toBe(true);
  return project;
}

describe('generated projects', () => {
  it('builds the CLI first', () => {
    expect(built.ok, built.output).toBe(true);
  });

  it.each(COMBINATIONS)('typechecks and lints with $name', async ({ name, features }) => {
    const project = await generate(name, features);
    await expectTypechecks(project);
    await expectDriftMatches(project);
    await expectPrunedShared(project);
    await expectLints(project);
    const api = await runBackendBoot(project);
    expect(api.ok, api.output).toBe(true);
  });

  it('keeps mailed proof and its sender when email-code sign-in is off', async () => {
    const project = join(workspace, 'email-code-off');
    const result = await scaffold(project, ['email-password']);
    expect(result.ok, result.output).toBe(true);
    for (const path of [
      'backend/src/mail/builders/proof-code.ts',
      'backend/src/mail/catalog/en/proof-code.ts',
      'backend/src/mail/catalog/ar/proof-code.ts',
    ]) {
      expect(existsSync(join(project, path)), path).toBe(true);
    }
    const contracts = readFileSync(
      join(project, 'backend/src/auth/contracts/auth-contracts.module.ts'),
      'utf8',
    );
    expect(contracts).toMatch(/provide:\s*FreshProofSender\b[^}]*useExisting:\s*MailService\b/u);
    const mail = readFileSync(join(project, 'backend/src/mail/mail.service.ts'), 'utf8');
    expect(mail).toContain('sendProofCode');
    const errors = readFileSync(join(project, 'shared/core/src/error-codes.ts'), 'utf8');
    const signIn = readFileSync(
      join(project, 'backend/src/config/utils/native-sign-in-config.util.ts'),
      'utf8',
    );
    expect(errors).not.toContain('EMAIL_CODE_INVALID');
    expect(signIn).not.toContain('emailCode');
  });

  it('typechecks and lints with everything the manifest offers', async () => {
    const requested = everything();
    const project = await generate('everything', requested);
    await expectTypechecks(project);
    await expectDriftMatches(project);
    await expectPrunedShared(project);
    await expectLints(project);
    const api = await runBackendBoot(project);
    expect(api.ok, api.output).toBe(true);

    // Retained application and API test files differ only by feature markers.
    const selected = resolveSelection(manifest, requested).selected;
    // No client was named, so the project is the web app and the mobile folders are gone.
    const ownership = defaultOwnership(manifest);
    const markerIds = [
      ...Object.keys(manifest.features),
      ...Object.keys(manifest.options),
      ...ownership.knownIds,
      ...databaseMarkerIds(manifest),
    ];
    const kept = [
      ...selected,
      ...Object.keys(manifest.options),
      ...ownership.keptIds,
      ...defaultDatabaseIds(manifest),
    ];
    // No database was named, so the project runs on the default one and what
    // the other databases own is gone.
    const otherDatabases = Object.entries(manifest.databases).filter(
      ([id]) => !defaultDatabaseIds(manifest).includes(id),
    );
    const differences = await compareWithRepository(project, kept, markerIds, [
      ...manifest.core.alwaysRemoveFiles,
      ...ownership.removedFiles,
      ...otherDatabases.flatMap(([, database]) => [...database.files, ...database.docs]),
    ]);
    expect(differences, JSON.stringify(differences, null, 2)).toEqual([]);
  });

  it('installs offline from a warm pnpm store and retained build-artifact cache', async () => {
    const project = await generate('warm-store', ['email-password']);
    for (const path of [
      'node_modules',
      'backend/node_modules',
      'frontend/node_modules',
      'shared/core/node_modules',
      'shared/sdk/node_modules',
    ]) {
      rmSync(join(project, path), { recursive: true, force: true });
    }
    const offline = await installFromWarmStore(project, inject('pnpmStore'));
    expect(offline.ok, offline.output).toBe(true);
    await expectTypechecks(project);
  });

  it('pulls OAuth core in behind a provider without offering it', () => {
    const selection = resolveSelection(manifest, ['email-password', 'google']);

    expect(selection.selected).toContain('oauth-core');
    expect(manifest.features['oauth-core'].kind).toBe('hidden');
  });
});
