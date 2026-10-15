import { Pool } from 'pg';
import {
  BACKFILL_COUNTS,
  expectBackfilled,
  FIRST_ID,
  LIVE_EXPIRY,
  migrationConfirmationService,
  SECOND_ID,
  seedBackfill,
  THIRD_ID,
} from '../../../../test/postgres/postgres-address-ledger-migration-fixtures';
import {
  applyPostgresMigrations,
  MIGRATION_LOCK_WAIT_MS,
} from './postgres-migrations';
import {
  ADDRESS_BACKFILL_ZERO_COUNTS,
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
  useMigrateDatabases,
} from './postgres-migrate.harness-spec';

const ADDRESS_CLAIMS_MIGRATION = '0021_address_claims.sql';
const LOSER_CODE_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e73';
const emails = async (pool: Pool) =>
  (
    await pool.query<{
      id: string;
      email: string | null;
    }>('SELECT id, email FROM users ORDER BY id')
  ).rows;

// These fixtures deliberately bypass application normalisation.
describe('address ledger PostgreSQL migration', () => {
  const { emptyDatabase, run, recorded } = useMigrateDatabases();
  const previousDatabase = async () => {
    const pool = await emptyDatabase();
    await applyPostgresMigrations(
      pool,
      MIGRATION_LOCK_WAIT_MS,
      EVERY_MIGRATION.filter((name) => name !== ADDRESS_CLAIMS_MIGRATION),
    );
    return pool;
  };

  it(
    'normalises legacy email and preserves nulls without pending addresses',
    async () => {
      const pool = await previousDatabase();
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2), ($3, NULL)',
        [FIRST_ID, ' Foo@Example.COM ', SECOND_ID],
      );
      expect(await run('up', pool)).toEqual({
        exit: 0,
        said: [
          ADDRESS_BACKFILL_ZERO_COUNTS,
          'Applied: 0021_address_claims.sql',
        ],
      });
      expect(await emails(pool)).toEqual([
        { id: FIRST_ID, email: 'foo@example.com' },
        { id: SECOND_ID, email: null },
      ]);
      expect((await recorded(pool)).includes(ADDRESS_CLAIMS_MIGRATION)).toBe(
        true,
      );
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'backfills only live bindings, clears unsafe pending data and replays once',
    async () => {
      const pool = await previousDatabase();
      await seedBackfill(pool);
      expect(await run('up', pool)).toEqual({
        exit: 0,
        said: [BACKFILL_COUNTS, 'Applied: 0021_address_claims.sql'],
      });
      await expectBackfilled(pool);
      await pool.query('DELETE FROM schema_migrations WHERE name = $1', [
        ADDRESS_CLAIMS_MIGRATION,
      ]);
      expect(await run('up', pool)).toEqual({
        exit: 0,
        said: [
          'relation "address_claims" already exists, skipping',
          ADDRESS_BACKFILL_ZERO_COUNTS,
          'Applied: 0021_address_claims.sql',
        ],
      });
      await expectBackfilled(pool);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'confirms the retained padded legacy code through the canonical address',
    async () => {
      const pool = await previousDatabase();
      const { hash, service } = migrationConfirmationService(pool);
      const code = '614208';
      const hashedCode = await hash.hash(code);
      await pool.query(
        `INSERT INTO users (id, email, pending_email, address_generation)
         VALUES ($1, 'original@example.test', ' Moved@Example.Test ', 7),
                ($2, 'loser@example.test', 'moved@example.test', 1)`,
        [FIRST_ID, SECOND_ID],
      );
      await pool.query(
        `INSERT INTO pending_registrations
           (email, purpose, user_id, address_generation, hashed_code, expires_at)
         VALUES (' MOVED@example.test ', 'email-change', $1, 7, $2, $3)`,
        [FIRST_ID, hashedCode, LIVE_EXPIRY],
      );
      await pool.query(
        `INSERT INTO pending_registrations
           (id, email, purpose, user_id, address_generation, hashed_code, expires_at)
         VALUES ($1, 'moved@example.test', 'email-change', $2, 0,
                 'stale-hash', $3)`,
        [LOSER_CODE_ID, SECOND_ID, LIVE_EXPIRY],
      );
      expect(await run('up', pool)).toEqual({
        exit: 0,
        said: [
          'Address ledger backfill: kept=1 cleared_taken=0 cleared_ambiguous=1 cleared_codeless=0 codes_killed=1',
          'Applied: 0021_address_claims.sql',
        ],
      });
      const migratedCodes = await pool.query<{ email: string }>(
        'SELECT email FROM pending_registrations',
      );
      expect(migratedCodes.rows).toEqual([{ email: 'moved@example.test' }]);
      const loserCode = await pool.query<{ id: string }>(
        'SELECT id FROM pending_registrations WHERE id = $1',
        [LOSER_CODE_ID],
      );
      expect(loserCode.rows).toEqual([]);

      const result = await service.confirm({
        email: 'moved@example.test',
        code,
      });

      expect(result.success).toBe(true);
      const account = await pool.query<{
        email: string;
        pending_email: string | null;
        is_verified: boolean;
      }>('SELECT email, pending_email, is_verified FROM users ORDER BY id');
      expect(account.rows).toEqual([
        { email: 'moved@example.test', pending_email: null, is_verified: true },
        {
          email: 'loser@example.test',
          pending_email: null,
          is_verified: false,
        },
      ]);
      const claims = await pool.query<{ address: string }>(
        'SELECT address FROM address_claims',
      );
      const codes = await pool.query<{ id: string }>(
        'SELECT id FROM pending_registrations',
      );
      expect(claims.rows).toEqual([]);
      expect(codes.rows).toEqual([]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'reports both colliding ids and leaves every legacy row unchanged',
    async () => {
      const pool = await previousDatabase();
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)',
        [
          FIRST_ID,
          ' A@X.com ',
          SECOND_ID,
          'a@x.com',
          THIRD_ID,
          ' Other@X.com ',
        ],
      );
      const failed = run('up', pool);
      await expect(failed).rejects.toThrow(FIRST_ID);
      await expect(failed).rejects.toThrow(SECOND_ID);
      await expect(failed).rejects.toThrow('2 users');
      expect(await emails(pool)).toEqual([
        { id: FIRST_ID, email: ' A@X.com ' },
        { id: SECOND_ID, email: 'a@x.com' },
        { id: THIRD_ID, email: ' Other@X.com ' },
      ]);
      expect((await recorded(pool)).includes(ADDRESS_CLAIMS_MIGRATION)).toBe(
        false,
      );
      expect(
        (
          await pool.query<{ name: string | null }>(
            "SELECT to_regclass('address_claims')::text AS name",
          )
        ).rows,
      ).toEqual([{ name: null }]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'enforces canonical claims and emails while keeping email uniqueness',
    async () => {
      const pool = await previousDatabase();
      expect(await run('up', pool)).toEqual({
        exit: 0,
        said: [
          ADDRESS_BACKFILL_ZERO_COUNTS,
          'Applied: 0021_address_claims.sql',
        ],
      });
      await pool.query("INSERT INTO users (email) VALUES ('a@x.com')");
      await expect(
        pool.query("INSERT INTO users (email) VALUES (' A@X.com ')"),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'user_email_normalised',
      });
      await expect(
        pool.query("INSERT INTO users (email) VALUES ('a@x.com')"),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'user_email_unique',
      });
      await expect(
        pool.query(
          "INSERT INTO address_claims VALUES (' A@X.com ', 'EMAIL_CHANGE', 'owner', now())",
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'address_claim_normalised',
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
