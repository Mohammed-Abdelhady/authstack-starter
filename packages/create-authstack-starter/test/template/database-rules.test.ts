import { existsSync, readFileSync } from 'node:fs';
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
  passkeys: { tables: ['passkeys', 'passkey_challenges'], migrations: ['0009_passkeys.sql'] },
  'magic-link': {
    tables: ['pending_magic_links'],
    migrations: ['0013_magic_links.sql', '0015_magic_link_request_nonce.sql'],
  },
  'email-code': { tables: ['email_codes'], migrations: ['0025_email_codes.sql'] },
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

  it('are created by a file of their own, so the list a pruned project carries stays in order', async () => {
    const all = (await listFiles(join(REPOSITORY, MIGRATIONS))).sort();
    const withoutOptional = all.filter(
      (file) =>
        !Object.values(FEATURE_TABLES).some(({ migrations }) => migrations.includes(file)) &&
        file.endsWith('.sql'),
    );

    expect(withoutOptional).toEqual([
      '0001_browser_issuance.sql',
      '0002_roles.sql',
      '0003_pending_codes.sql',
      '0004_browser_proofs_security_events.sql',
      '0005_accounts.sql',
      '0006_session_authority_revocation.sql',
      '0007_applications_grants.sql',
      '0010_native_sign_in.sql',
      '0011_session_listing.sql',
      '0012_retention_indexes.sql',
      '0014_code_guess_locks.sql',
      '0016_pending_email.sql',
      '0018_native_attempts.sql',
      '0019_account_locale.sql',
      '0020_host_migrations.sql',
      '0021_address_claims.sql',
    ]);
    for (const file of withoutOptional) {
      const sql = readFileSync(join(REPOSITORY, MIGRATIONS, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      for (const { tables } of Object.values(FEATURE_TABLES)) {
        for (const table of tables) {
          expect(new RegExp(`\\b${table}\\b`).test(sql), `${file} names ${table}`).toBe(false);
        }
      }
    }
  });
});

/** A file as a project of `database` holds it when the rewrites run: its markers taken out. */
function asProjectHolds(database: string, file: string): string {
  const source = readFileSync(join(REPOSITORY, file), 'utf8');
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return source;
  const { kept, known } = markerIds(database);
  return stripFeatureMarkers(source, file, kept, known).content;
}

describe('what the chosen database renames and rewrites', () => {
  it('finds every text it rewrites in the repository, in a file the rule names', async () => {
    const tracked = await listFiles(REPOSITORY);
    const stale: string[] = [];
    for (const [id, database] of Object.entries(manifest.databases)) {
      // A rule names a file as the project has it, after the renames.
      const before = new Map(Object.entries(database.renames).map(([from, to]) => [to, from]));
      const sources = tracked.map((file): [string, string] => [file, file]);
      for (const [to, from] of before) sources.push([to, from]);
      for (const rewrite of database.rewrites) {
        const found = sources.some(
          ([name, file]) =>
            matchesAnyGlob(name, rewrite.files) &&
            existsSync(join(REPOSITORY, file)) &&
            asProjectHolds(id, file).includes(rewrite.from),
        );
        if (!found) stale.push(`${id}: ${JSON.stringify(rewrite.from)}`);
        // A rule that names a file by its path says the text is in that file.
        for (const named of rewrite.files.filter((file) => !file.includes('*'))) {
          const file = before.get(named) ?? named;
          if (!existsSync(join(REPOSITORY, file))) {
            stale.push(`${id}: ${named} is not there, for ${JSON.stringify(rewrite.from)}`);
          } else if (!asProjectHolds(id, file).includes(rewrite.from)) {
            stale.push(`${id}: ${named} does not hold ${JSON.stringify(rewrite.from)}`);
          }
        }
      }
    }
    const counted = Object.values(manifest.databases).flatMap((database) => database.rewrites);

    expect({ stale, rules: counted.length > 0 }).toEqual({ stale: [], rules: true });
  });

  it('renames only files the repository carries, to names the other database frees', async () => {
    const tracked = new Set(await listFiles(REPOSITORY));
    const problems: string[] = [];
    for (const [id, database] of Object.entries(manifest.databases)) {
      const freed = Object.entries(manifest.databases)
        .filter(([other]) => other !== id)
        .flatMap(([, other]) => other.files);
      for (const [from, to] of Object.entries(database.renames)) {
        if (!tracked.has(from)) problems.push(`${id} renames ${from}, which is not there`);
        if (tracked.has(to) && !matchesAnyGlob(to, freed)) {
          problems.push(`${id} renames ${from} to ${to}, which no other database gives up`);
        }
      }
    }

    const renames = Object.values(manifest.databases).flatMap((entry) =>
      Object.keys(entry.renames),
    );

    expect({ problems, renames: renames.length > 0 }).toEqual({ problems: [], renames: true });
  });
});
