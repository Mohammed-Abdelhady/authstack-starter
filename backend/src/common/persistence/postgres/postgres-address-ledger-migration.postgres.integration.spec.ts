import { Pool } from 'pg';
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
const FIRST_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e51';
const SECOND_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e52';
const THIRD_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e53';
const USER_IDS = [
  FIRST_ID,
  SECOND_ID,
  THIRD_ID,
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e54',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e55',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e56',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e57',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e58',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e59',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e60',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e61',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e62',
  '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e63',
];
const LIVE_EXPIRY = new Date('2099-01-01T13:00:00.000Z');
const EARLIER_EXPIRY = new Date('2099-01-01T12:30:00.000Z');
const EXPIRED = new Date('2000-01-01T00:00:00.000Z');
const BACKFILL_COUNTS =
  'Address ledger backfill: kept=2 cleared_taken=1 cleared_ambiguous=5 cleared_codeless=4 codes_killed=6';

async function seedBackfill(pool: Pool) {
  const pending = [
    null,
    ' TAKEN@Example.Test ',
    ' Shared@Example.Test ',
    'shared@example.test',
    ' Orphan@Example.Test ',
    'orphan@example.test',
    ' Stale@Example.Test ',
    ' Expired@Example.Test ',
    ' Solo@Example.Test ',
    ' Codeless@Example.Test ',
    ' Ambiguous@Example.Test ',
    'ambiguous@example.test',
    ' Wrong@Example.Test ',
  ];
  const generations = [0, 1, 7, 1, 0, 0, 4, 1, 2, 0, 1, 1, 1];
  for (const [index, id] of USER_IDS.entries()) {
    await pool.query(
      `INSERT INTO users
         (id, email, pending_email, address_generation, is_deleted)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        index === 0 ? ' Taken@Example.Test ' : `${id}@example.test`,
        pending[index],
        generations[index],
        index === 0,
      ],
    );
  }
  const codes: [string, number, number, Date][] = [
    [' taken@EXAMPLE.test ', 1, 1, LIVE_EXPIRY],
    [' SHARED@example.test ', 2, 7, LIVE_EXPIRY],
    ['shared@example.test', 3, 0, LIVE_EXPIRY],
    ['shared@example.test ', 2, 7, EARLIER_EXPIRY],
    ['stale@example.test', 6, 3, LIVE_EXPIRY],
    ['expired@example.test', 7, 1, EXPIRED],
    [' SOLO@example.test ', 8, 2, LIVE_EXPIRY],
    [' Ambiguous@example.test ', 10, 1, LIVE_EXPIRY],
    ['ambiguous@example.test', 11, 1, LIVE_EXPIRY],
    ['wrong@example.test', 2, 1, LIVE_EXPIRY],
    ['unrelated@example.test', 2, 7, LIVE_EXPIRY],
  ];
  for (const [address, owner, generation, expiry] of codes) {
    await pool.query(
      `INSERT INTO pending_registrations
         (email, purpose, user_id, address_generation, hashed_code, expires_at)
       VALUES ($1, 'email-change', $2, $3, 'legacy-hash', $4)`,
      [address, USER_IDS[owner], generation, expiry],
    );
  }
  await pool.query(
    `INSERT INTO pending_registrations
       (email, purpose, hashed_code, expires_at)
     VALUES (' taken@EXAMPLE.test ', 'signup', 'signup-hash', $1)`,
    [LIVE_EXPIRY],
  );
}

async function expectBackfilled(pool: Pool) {
  const pending = await pool.query<{ pending_email: string | null }>(
    'SELECT pending_email FROM users ORDER BY id',
  );
  expect(pending.rows.map((row) => row.pending_email)).toEqual([
    null,
    null,
    'shared@example.test',
    null,
    null,
    null,
    null,
    null,
    'solo@example.test',
    null,
    null,
    null,
    null,
  ]);
  const claims = await pool.query<{
    address: string;
    kind: string;
    owner: string;
    lapses_at: Date;
  }>('SELECT * FROM address_claims ORDER BY address');
  expect(claims.rows).toEqual([
    {
      address: 'shared@example.test',
      kind: 'EMAIL_CHANGE',
      owner: THIRD_ID,
      lapses_at: EARLIER_EXPIRY,
    },
    {
      address: 'solo@example.test',
      kind: 'EMAIL_CHANGE',
      owner: USER_IDS[8],
      lapses_at: LIVE_EXPIRY,
    },
  ]);
  const codes = await pool.query<{ email: string; purpose: string }>(
    'SELECT email, purpose FROM pending_registrations ORDER BY email, purpose',
  );
  expect(codes.rows).toEqual([
    { email: ' SHARED@example.test ', purpose: 'email-change' },
    { email: ' SOLO@example.test ', purpose: 'email-change' },
    { email: ' taken@EXAMPLE.test ', purpose: 'signup' },
    { email: 'shared@example.test', purpose: 'email-change' },
    { email: 'shared@example.test ', purpose: 'email-change' },
    { email: 'unrelated@example.test', purpose: 'email-change' },
  ]);
}

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
