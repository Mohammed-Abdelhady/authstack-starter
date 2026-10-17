import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stripFeatureMarkers } from '../../src/prune/markers.js';
import type { Manifest } from '../../src/types.js';
import { listFiles } from '../../src/utils/fs.js';
import { matchesAnyGlob } from '../../src/utils/glob.js';
import {
  markerIds as markerIdsOf,
  readOwnershipSource,
  removedGlobs as removedGlobsOf,
  REPOSITORY,
} from './database-ownership-support.js';

let manifest: Manifest;
let backendFiles: string[];

beforeAll(async () => {
  ({ manifest, backendFiles } = await readOwnershipSource());
});

const markerIds = (database: string) => markerIdsOf(manifest, database);
const removedGlobs = (database: string) => removedGlobsOf(manifest, database);

/** The PostgreSQL tables an optional feature owns, written out by hand. */
const FEATURE_TABLES: Record<string, { tables: string[]; migrations: string[] }> = {
  totp: {
    tables: ['user_two_factor', 'user_recovery_codes', 'two_factor_challenges'],
    migrations: ['0008_two_factor.sql', '0017_two_factor_lockout.sql'],
  },
  passkeys: {
    tables: ['passkeys', 'passkey_challenges'],
    migrations: ['0009_passkeys.sql', '0026_passkey_relying_party.sql'],
  },
  'magic-link': {
    tables: ['pending_magic_links'],
    migrations: ['0013_magic_links.sql', '0015_magic_link_request_nonce.sql'],
  },
  'email-code': { tables: ['email_codes'], migrations: ['0025_email_codes.sql'] },
  'oauth-core': {
    tables: ['provider_tokens', 'provider_revocations', 'provider_link_tickets'],
    migrations: ['0032_provider_revocations.sql'],
  },
};
const MIGRATIONS = 'backend/src/common/persistence/postgres/migrations';

describe('the PostgreSQL tables of an optional feature', () => {
  it.each(Object.keys(FEATURE_TABLES))(
    'are named by nothing a PostgreSQL project keeps once %s is left out',
    async (feature) => {
      const { tables, migrations } = FEATURE_TABLES[feature];
      const removed = [...removedGlobs('postgres'), ...manifest.features[feature].files];
      const { kept, known } = markerIds('postgres');
      kept.delete(feature);
      // A table as a statement names it: in a query, in the table map or in SQL.
      const named = new RegExp(
        `(?:['"\`]|\\b(?:TABLE|ON|FROM|INTO|UPDATE|REFERENCES|JOIN|USING)\\s+)(?:${tables.join('|')})\\b|^\\s*(?:${tables.join('|')}):`,
        'm',
      );

      const files = [
        ...backendFiles,
        ...(await listFiles(join(REPOSITORY, MIGRATIONS))).map((file) => `${MIGRATIONS}/${file}`),
      ].filter((file) => /\/persistence\/postgres\/|^backend\/test\/postgres\//.test(file));
      const naming = files.filter((file) => {
        if (matchesAnyGlob(file, removed)) return false;
        const source = readFileSync(join(REPOSITORY, file), 'utf8');
        const content = file.endsWith('.sql')
          ? source
          : stripFeatureMarkers(source, file, kept, known).content;
        return named.test(content);
      });

      expect({
        naming,
        migrationsLeft: migrations.filter(
          (migration) => !matchesAnyGlob(`${MIGRATIONS}/${migration}`, removed),
        ),
        checked: files.length > 50,
      }).toEqual({ naming: [], migrationsLeft: [], checked: true });
    },
  );
});
