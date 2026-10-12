import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unclassifiedMutationNames } from './mutationSweepGuard';
import { CONVERTED, EXCEPTIONS } from './invalidationRefetchCases';
import { UNTAGGED } from './untaggedRefetchCases';
import { authApi } from '@/modules/auth/store/authApi';
import { oauthApi } from '@/modules/oauth/api/oauthApi';
import { CONVERTED as ACCOUNT } from '@/modules/account/api/__tests__/sweepCases';
import {
  CONVERTED as MAGIC,
  UNTAGGED as MAGIC_UNTAGGED,
} from '@/modules/auth/methods/magic-link/__tests__/sweepCases';
import {
  CONVERTED as PASSKEYS,
  UNTAGGED as PASSKEYS_UNTAGGED,
} from '@/modules/passkeys/api/__tests__/sweepCases';
import {
  CONVERTED as TWO_FACTOR,
  UNTAGGED as TWO_FACTOR_UNTAGGED,
} from '@/modules/two-factor/api/__tests__/sweepCases';

/** Every current endpoint injector, imported through the case lists above. */
const DECLARED_INJECTORS = [
  'src/modules/account/api/accountLinkingApi.ts',
  'src/modules/account/api/profileSyncApi.ts',
  'src/modules/auth/store/authApi.ts',
  'src/modules/auth/api/authMethodsApi.ts',
  'src/modules/auth/methods/magic-link/magicLinkApi.ts',
  'src/modules/oauth/api/oauthApi.ts',
  'src/modules/passkeys/api/passkeysApi.ts',
  'src/modules/roles/api/rolesApi.ts',
  'src/modules/permissions/api/permissionsApi.ts',
  'src/modules/sessions/api/sessionsApi.ts',
  'src/modules/two-factor/api/twoFactorApi.ts',
  'src/modules/users/api/usersApi.ts',
];

/** Every ts file under src, relative to the frontend root. */
function tsFilesUnder(rootDir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const path = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      for (const child of tsFilesUnder(path)) found.push(child);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

describe('mutation sweep coverage', () => {
  it('classifies every mutation endpoint its import graph holds', () => {
    const classified = [
      ...[
        ...CONVERTED,
        ...EXCEPTIONS,
        ...UNTAGGED,
        ...ACCOUNT,
        ...MAGIC,
        ...MAGIC_UNTAGGED,
        ...PASSKEYS,
        ...PASSKEYS_UNTAGGED,
        ...TWO_FACTOR,
        ...TWO_FACTOR_UNTAGGED,
      ].map((mutation) => mutation.name),
    ];
    expect(new Set(classified).size).toBe(classified.length);
    // OAuth currently has only a read, but its slice must be loaded here so
    // a new write cannot escape the registry check.
    expect(unclassifiedMutationNames(oauthApi, classified)).toEqual([]);
    expect(unclassifiedMutationNames(authApi, classified)).toEqual([]);
  });

  /** This reads the file list on purpose: it guards the slice-file structure
   * the classification guards above depend on, so a slice with no guard
   * anywhere cannot appear unnoticed. */
  it('declares every source file that injects endpoints', () => {
    const srcDir = fileURLToPath(new URL('../../../../', import.meta.url));
    const injectors = tsFilesUnder(srcDir)
      // Test files mention the call in their lists; the structure guard is
      // about production API slices.
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => /\.injectEndpoints\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(srcDir.length))
      .sort();

    for (const file of DECLARED_INJECTORS) {
      expect(existsSync(join(srcDir, file)), `${file} must exist`).toBe(true);
    }
    expect(injectors).toEqual([...DECLARED_INJECTORS].sort());
  });
});
