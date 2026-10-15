import { Pool } from 'pg';
import {
  applyPostgresMigrations,
  MIGRATION_LOCK_WAIT_MS,
} from './postgres-migrations';
import {
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
  useMigrateDatabases,
} from './postgres-migrate.harness-spec';

const ADDRESS_CLAIMS_MIGRATION = '0021_address_claims.sql';
const FIRST_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e51';
const SECOND_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e52';
const THIRD_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e53';

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
    'normalises legacy email, preserves nulls and reruns without changes',
    async () => {
      const pool = await previousDatabase();
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2), ($3, NULL)',
        [FIRST_ID, ' Foo@Example.COM ', SECOND_ID],
      );
      await run('up', pool);
      expect(await emails(pool)).toEqual([
        { id: FIRST_ID, email: 'foo@example.com' },
        { id: SECOND_ID, email: null },
      ]);
      expect((await run('up', pool)).exit).toBe(0);
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
      await run('up', pool);
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
