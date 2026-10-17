import {
  APPLICATION_PLATFORM,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';
import {
  applyPostgresMigrations,
  MIGRATION_LOCK_WAIT_MS,
} from './postgres-migrations';
import {
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
  useMigrateDatabases,
} from './postgres-migrate.harness-spec';

const POLICY_MIGRATIONS = [
  '0022_application_policy.sql',
  '0023_account_audience.sql',
  '0024_session_evidence.sql',
];

interface ApplicationPolicyRow {
  sign_up: string;
  require_passkey: boolean;
  sign_in_methods: null;
  account_audience: string | null;
  policy_version: number;
  session_cap: number | null;
  unbound_absolute_lifetime_ms: string | null;
  unbound_idle_lifetime_ms: string | null;
  audiences: string[];
}

interface SessionEvidenceRow {
  user_verified: boolean;
  policy_version: number;
  authentication_methods: string[];
  is_valid: boolean;
  audience: string;
  token_hash: string;
  expires_at: Date;
  idle_expires_at: Date;
}

describe('application policy and evidence upgrade', () => {
  const { emptyDatabase, run, recorded } = useMigrateDatabases();

  it(
    'preserves existing authority and leaves audiences unmapped',
    async () => {
      const pool = await emptyDatabase();
      await applyPostgresMigrations(
        pool,
        MIGRATION_LOCK_WAIT_MS,
        EVERY_MIGRATION.filter((name) => name < POLICY_MIGRATIONS[0]),
      );
      const account = await pool.query<{ id: string }>(
        'INSERT INTO users DEFAULT VALUES RETURNING id',
      );
      await pool.query(
        "INSERT INTO roles (name, slug, created_at, updated_at) VALUES ('Legacy', 'legacy', now(), now())",
      );
      await pool.query(
        `INSERT INTO applications (
          client_id, environment, platform, display_name, client_type,
          absolute_lifetime_ms, idle_lifetime_ms, policy_version, audiences
        ) VALUES ($1, 'test', $2, 'Web', 'public', 7200000, 600000, 7, '{api}')`,
        [WEB_CLIENT_ID, APPLICATION_PLATFORM.WEB],
      );
      await pool.query(
        `INSERT INTO sessions (
          user_id, token_hash, user_agent, ip, client_id, user_version,
          client_version, grant_version, auth_epoch, schema_version,
          scopes, audience, authentication_methods, credential_purpose,
          browser_generation, authenticated_at, last_used_at, last_activity_at,
          expires_at, idle_expires_at
        ) VALUES (
          $1, decode('1234', 'hex'), 'Legacy/1', '127.0.0.1', $2, 0,
          0, 0, 1, 1, '{api}', 'api', '{pwd}', 'browser_session', 1,
          '2099-01-01T12:00:00Z', '2099-01-01T12:00:00Z',
          '2099-01-01T12:00:00Z', '2099-01-01T14:00:00Z',
          '2099-01-01T12:10:00Z'
        )`,
        [account.rows[0].id, WEB_CLIENT_ID],
      );

      await run('up', pool);
      const application = await pool.query<ApplicationPolicyRow>(
        `SELECT sign_up, require_passkey, sign_in_methods,
                account_audience, policy_version,
                session_cap, unbound_absolute_lifetime_ms,
                unbound_idle_lifetime_ms, audiences FROM applications`,
      );
      const session = await pool.query<SessionEvidenceRow>(
        `SELECT user_verified, policy_version, authentication_methods,
                is_valid, audience, encode(token_hash, 'hex') AS token_hash,
                expires_at, idle_expires_at FROM sessions`,
      );
      const audiences = await pool.query<{ audience: string | null }>(
        'SELECT audience FROM users UNION ALL SELECT audience FROM roles',
      );

      expect({
        // Newer migrations sort after these, so match them by name.
        migrations: (await recorded(pool)).filter((name) =>
          POLICY_MIGRATIONS.includes(name),
        ),
        application: application.rows,
        session: session.rows,
        audiences: audiences.rows,
        replay: await run('up', pool),
      }).toEqual({
        migrations: POLICY_MIGRATIONS,
        application: [
          {
            sign_up: 'open',
            require_passkey: false,
            sign_in_methods: null,
            account_audience: null,
            policy_version: 7,
            session_cap: null,
            unbound_absolute_lifetime_ms: null,
            unbound_idle_lifetime_ms: null,
            audiences: ['api'],
          },
        ],
        session: [
          {
            user_verified: false,
            policy_version: 0,
            authentication_methods: ['pwd'],
            is_valid: true,
            audience: 'api',
            token_hash: '1234',
            expires_at: new Date('2099-01-01T14:00:00.000Z'),
            idle_expires_at: new Date('2099-01-01T12:10:00.000Z'),
          },
        ],
        audiences: [{ audience: null }, { audience: null }],
        replay: {
          exit: 0,
          said: ['Nothing to apply. The database is up to date.'],
        },
      });
      await expect(
        pool.query("UPDATE applications SET sign_in_methods = '[]'::jsonb"),
      ).rejects.toMatchObject({
        constraint: 'application_sign_in_methods_object',
      });
      // Added NOT VALID to skip the upgrade scan, the checks still refuse new values.
      await expect(
        pool.query("UPDATE users SET audience = 'robot'"),
      ).rejects.toMatchObject({ constraint: 'user_audience_valid' });
      await expect(
        pool.query('UPDATE sessions SET policy_version = -1'),
      ).rejects.toMatchObject({
        constraint: 'session_policy_version_not_negative',
      });
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
