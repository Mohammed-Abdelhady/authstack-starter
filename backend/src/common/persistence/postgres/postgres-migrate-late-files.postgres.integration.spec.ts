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

/** What is left to apply once the first four files are in. */
const AFTER_THE_FOURTH = EVERY_MIGRATION.slice(4);

/** A core file missing from a build that carried newer migrations. */
const ACCOUNT_LOCALE = '0019_account_locale.sql';

// feature:totp,passkeys,magic-link:start
/** The files a feature owns. A project that gains the feature gets its files late. */
const FEATURE_FILES = [
  ['0008_two_factor.sql', '0017_two_factor_lockout.sql'], // feature:totp
  ['0009_passkeys.sql', '0026_passkey_relying_party.sql'], // feature:passkeys
  ['0013_magic_links.sql', '0015_magic_link_request_nonce.sql'], // feature:magic-link
  ['0025_email_codes.sql'], // feature:email-code
];
// feature:totp,passkeys,magic-link:end

describe('PostgreSQL migrations applied out of the usual order', () => {
  const { emptyDatabase, run, recorded, startUp } = useMigrateDatabases();

  it(
    'leaves nothing of a migration that failed part way, and applies only what is missing afterwards',
    async () => {
      const pool = await emptyDatabase();
      // 0005 adds the password column first and creates this table later.
      await pool.query('CREATE TABLE user_linked_accounts (blocker integer)');

      const failure = await run('up', pool).then(
        () => 'applied',
        (error: { code?: string }) => error.code,
      );
      const passwordColumn = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash'",
      );
      const status = await run('status', pool);
      const recordedAfterFailure = await recorded(pool);
      const refused = await startUp(pool);
      await pool.query('DROP TABLE user_linked_accounts');

      expect({
        failure,
        passwordColumns: passwordColumn.rowCount,
        status,
        recordedAfterFailure,
        refused,
        again: await run('up', pool),
        recorded: await recorded(pool),
        after: await startUp(pool),
      }).toEqual({
        failure: '42P07',
        passwordColumns: 0,
        status: {
          exit: 1,
          said: [
            'Applied: 4',
            `Pending: ${AFTER_THE_FOURTH.join(', ')}`,
            'Not carried by this build: none',
            'Host applied: 0',
            'Host pending: none',
            'Host not carried by this build: none',
          ],
        },
        recordedAfterFailure: [
          '0001_browser_issuance.sql',
          '0002_roles.sql',
          '0003_pending_codes.sql',
          '0004_browser_proofs_security_events.sql',
        ],
        refused: 'StorageNotReadyError',
        again: {
          exit: 0,
          said: [
            ADDRESS_BACKFILL_ZERO_COUNTS,
            `Applied: ${AFTER_THE_FOURTH.join(', ')}`,
          ],
        },
        recorded: EVERY_MIGRATION,
        after: 'serves',
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'applies 0019 after newer core migrations, and its accounts read en',
    async () => {
      const pool = await emptyDatabase();
      const previousBuild = EVERY_MIGRATION.filter(
        (name) => name !== ACCOUNT_LOCALE,
      );
      await applyPostgresMigrations(
        pool,
        MIGRATION_LOCK_WAIT_MS,
        previousBuild,
      );
      await pool.query(
        "INSERT INTO users (email, name, role, created_at, updated_at) VALUES ('before@example.test', 'Before', 'user', now(), now())",
      );

      const refused = await startUp(pool);
      const up = await run('up', pool);
      const locale = await pool.query<{ locale: string }>(
        "SELECT locale FROM users WHERE email = 'before@example.test'",
      );

      expect({
        // Every migration newer than 0019 was applied before 0019 was.
        newerThanLocale: previousBuild.filter((name) => name > ACCOUNT_LOCALE),
        refused,
        up,
        recorded: await recorded(pool),
        locales: locale.rows,
        after: await startUp(pool),
      }).toEqual({
        newerThanLocale: [
          '0020_host_migrations.sql',
          '0021_address_claims.sql',
          '0022_application_policy.sql',
          '0023_account_audience.sql',
          '0024_session_evidence.sql',
          '0025_email_codes.sql', // feature:email-code
          '0026_passkey_relying_party.sql', // feature:passkeys
          '0027_activity_log.sql',
          '0028_staff_console.sql',
        ],
        refused: 'StorageNotReadyError',
        up: { exit: 0, said: ['Applied: 0019_account_locale.sql'] },
        recorded: EVERY_MIGRATION,
        locales: [{ locale: 'en' }],
        after: 'serves',
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  // feature:totp,passkeys,magic-link:start
  it(
    'applies a feature file after higher numbers when the project gains the feature, and then serves',
    async () => {
      const seen: Record<string, unknown> = {};
      for (const files of FEATURE_FILES) {
        const without = EVERY_MIGRATION.filter((name) => !files.includes(name));
        const pool = await emptyDatabase();
        await applyPostgresMigrations(pool, MIGRATION_LOCK_WAIT_MS, without);

        const servedWithout = await startUp(pool, without);
        const refusedWith = await startUp(pool);
        const up = await run('up', pool);
        seen[files[0]] = {
          servedWithout,
          refusedWith,
          up,
          recorded: await recorded(pool),
          after: await startUp(pool),
        };
      }

      const gained = (...files: string[]) => ({
        servedWithout: 'serves',
        refusedWith: 'StorageNotReadyError',
        up: { exit: 0, said: [`Applied: ${files.join(', ')}`] },
        recorded: EVERY_MIGRATION,
        after: 'serves',
      });
      expect(seen).toEqual({
        // feature:totp:start
        '0008_two_factor.sql': gained(
          '0008_two_factor.sql',
          '0017_two_factor_lockout.sql',
        ),
        // feature:totp:end
        // feature:passkeys:start
        '0009_passkeys.sql': gained(
          '0009_passkeys.sql',
          '0026_passkey_relying_party.sql',
        ),
        // feature:passkeys:end
        // feature:magic-link:start
        '0013_magic_links.sql': gained(
          '0013_magic_links.sql',
          '0015_magic_link_request_nonce.sql',
        ),
        // feature:magic-link:end
        '0025_email_codes.sql': gained('0025_email_codes.sql'), // feature:email-code
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
  // feature:totp,passkeys,magic-link:end

  // feature:magic-link:start
  it(
    'records 0013 on a database the old 0003 already gave the magic link table, and changes nothing in it',
    async () => {
      const pool = await emptyDatabase();
      await run('up', pool);
      // What the old 0003 left: the table and both indexes, and no 0013.
      await pool.query(
        "DELETE FROM schema_migrations WHERE name = '0013_magic_links.sql'",
      );
      await pool.query(
        "INSERT INTO pending_magic_links (email, token_hash, expires_at) VALUES ('kept@example.test', 'kept-hash', '2099-01-01T12:15:00Z')",
      );
      const shape = async () => ({
        columns: (
          await pool.query<{ name: string }>(
            "SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'pending_magic_links' ORDER BY ordinal_position",
          )
        ).rows.map(({ name }) => name),
        indexes: (
          await pool.query<{ name: string }>(
            "SELECT indexname AS name FROM pg_indexes WHERE tablename = 'pending_magic_links' ORDER BY indexname",
          )
        ).rows.map(({ name }) => name),
        rows: (
          await pool.query<{ email: string }>(
            'SELECT email FROM pending_magic_links',
          )
        ).rows.map(({ email }) => email),
      });

      const refused = await startUp(pool);
      const up = await run('up', pool);

      expect({
        refused,
        up,
        recorded: await recorded(pool),
        shape: await shape(),
        after: await startUp(pool),
      }).toEqual({
        refused: 'StorageNotReadyError',
        up: {
          exit: 0,
          said: [
            'relation "pending_magic_links" already exists, skipping',
            'relation "pending_magic_link_email_created" already exists, skipping',
            'relation "pending_magic_link_expires_at" already exists, skipping',
            'Applied: 0013_magic_links.sql',
          ],
        },
        recorded: EVERY_MIGRATION,
        shape: {
          columns: [
            'id',
            'email',
            'token_hash',
            'expires_at',
            'consumed_at',
            'request_ip',
            'user_agent',
            'redirect',
            'created_at',
            'request_nonce_hash',
          ],
          indexes: [
            'pending_magic_link_email_created',
            'pending_magic_link_expires_at',
            'pending_magic_link_token_hash_unique',
            'pending_magic_links_pkey',
          ],
          rows: ['kept@example.test'],
        },
        after: 'serves',
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
  // feature:magic-link:end
});
