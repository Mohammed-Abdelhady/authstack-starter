import { WEB_CLIENT_ID } from '../../constants/client-ids';
import { Pool } from 'pg';
import { sql } from 'kysely';
import { PersistenceUnavailableError } from '../../../common/persistence/persistence-errors';
import { openPostgresDatabase } from '../../../common/persistence/postgres/postgres-database';
import { applyPostgresMigrations } from '../../../common/persistence/postgres/postgres-migrations';
import {
  PostgresUnitOfWorkRunner,
  postgresTransactionOf,
} from '../../../common/persistence/postgres/postgres-unit-of-work';
import {
  bootPostgresIssuanceHarness,
  PostgresIssuanceHarness,
} from '../../../../test/postgres/postgres-issuance-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  contractSession,
  holdReruns,
  rejectionOf,
  rerunAtOnce,
  SIGN_IN_ADDRESS,
  WEB_APPLICATION,
} from '../../../../test/utils/session/issuance-contract/issuance-contract-support';

const HASH = 'c'.repeat(64);
const READ_BEHIND_THE_FIRST = 'read the account while the first held it';
const REFUSED_AT_THE_READ = 'refused at the account read';

/** Facts about the PostgreSQL adapter that the shared contract cannot state. */
describe('PostgreSQL adapter', () => {
  let harness: PostgresIssuanceHarness;
  let gates: RaceGate[] = [];
  let restores: Array<() => void> = [];

  beforeAll(async () => {
    harness = await bootPostgresIssuanceHarness();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await harness.reset();
    await harness.seedApplication(WEB_APPLICATION);
  }, POSTGRES_RESET_TIMEOUT_MS);

  afterEach(() => {
    for (const gate of gates) gate.release();
    for (const restore of restores) restore();
    gates = [];
    restores = [];
  });

  it('takes the account before any version is read: a second sign-in is refused at its first read', async () => {
    const userId = await harness.seedAccount();
    const reruns = holdReruns();
    const firstRead = new RaceGate();
    const secondRead = new RaceGate();
    gates.push(reruns.refused, firstRead, secondRead);
    // The application is read straight after the account, before any write.
    restores.push(
      holdBefore(harness.applications, 'requireEnabled', (call) =>
        call === 0 ? firstRead : secondRead,
      ),
    );
    const service = harness.service(reruns.pause);

    const first = service.createBrowserSession(
      userId,
      'first/1',
      SIGN_IN_ADDRESS,
      WEB_CLIENT_ID,
    );
    await firstRead.reached(1);
    const second = service.createBrowserSession(
      userId,
      'second/1',
      SIGN_IN_ADDRESS,
      WEB_CLIENT_ID,
    );
    const secondWas = await Promise.race([
      reruns.refused.reached(1).then(() => REFUSED_AT_THE_READ),
      secondRead.reached(1).then(() => READ_BEHIND_THE_FIRST),
    ]);
    firstRead.release();
    secondRead.release();
    await first;
    reruns.refused.release();
    await second;

    expect({
      secondWas,
      sessions: (await harness.sessions(userId)).length,
      fence: (await harness.account(userId))?.issuanceFence,
    }).toEqual({ secondWas: REFUSED_AT_THE_READ, sessions: 2, fence: 2 });
  });

  it('runs a unit of work at read committed', async () => {
    const level = await harness.runner(rerunAtOnce).run(async (unitOfWork) => {
      const result = await sql<{
        transaction_isolation: string;
      }>`SHOW transaction_isolation`.execute(postgresTransactionOf(unitOfWork));
      return result.rows[0].transaction_isolation;
    });

    expect(level).toBe('read committed');
  });

  it('applies each migration once and records it', async () => {
    const again = await applyPostgresMigrations(harness.pool);
    const recorded = await harness.pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    );

    expect({
      first: harness.appliedMigrations,
      again,
      recorded: recorded.rows.map(({ name }) => name),
    }).toEqual({
      first: [
        '0001_browser_issuance.sql',
        '0002_roles.sql',
        '0003_pending_codes.sql',
        '0004_browser_proofs_security_events.sql',
        '0005_accounts.sql',
        '0006_session_authority_revocation.sql',
        '0007_applications_grants.sql',
        '0008_two_factor.sql', // feature:totp
        '0009_passkeys.sql', // feature:passkeys
        '0010_native_sign_in.sql',
        '0011_session_listing.sql',
        '0012_retention_indexes.sql',
        '0013_magic_links.sql', // feature:magic-link
        '0014_code_guess_locks.sql',
        '0015_magic_link_request_nonce.sql', // feature:magic-link
        '0016_pending_email.sql',
        '0017_two_factor_lockout.sql', // feature:totp
        '0018_native_attempts.sql',
        '0019_account_locale.sql',
        '0020_host_migrations.sql',
        '0021_address_claims.sql',
        '0022_application_policy.sql',
        '0023_account_audience.sql',
        '0024_session_evidence.sql',
        '0025_email_codes.sql', // feature:email-code
        '0026_passkey_relying_party.sql', // feature:passkeys
        '0027_activity_log.sql',
        '0029_account_erasure.sql',
      ],
      again: [],
      recorded: [
        '0001_browser_issuance.sql',
        '0002_roles.sql',
        '0003_pending_codes.sql',
        '0004_browser_proofs_security_events.sql',
        '0005_accounts.sql',
        '0006_session_authority_revocation.sql',
        '0007_applications_grants.sql',
        '0008_two_factor.sql', // feature:totp
        '0009_passkeys.sql', // feature:passkeys
        '0010_native_sign_in.sql',
        '0011_session_listing.sql',
        '0012_retention_indexes.sql',
        '0013_magic_links.sql', // feature:magic-link
        '0014_code_guess_locks.sql',
        '0015_magic_link_request_nonce.sql', // feature:magic-link
        '0016_pending_email.sql',
        '0017_two_factor_lockout.sql', // feature:totp
        '0018_native_attempts.sql',
        '0019_account_locale.sql',
        '0020_host_migrations.sql',
        '0021_address_claims.sql',
        '0022_application_policy.sql',
        '0023_account_audience.sql',
        '0024_session_evidence.sql',
        '0025_email_codes.sql', // feature:email-code
        '0026_passkey_relying_party.sql', // feature:passkeys
        '0027_activity_log.sql',
        '0029_account_erasure.sql',
      ],
    });
  });

  it('stores the token hash as bytes, dates as instants and an absent device name as null', async () => {
    const userId = await harness.seedAccount();
    const session = contractSession(userId, HASH);

    const sessionId = await harness
      .runner(rerunAtOnce)
      .run((unitOfWork) =>
        harness.store.insertBrowserSession(unitOfWork, session),
      );

    const stored = await harness.pool.query<{
      hash_type: string;
      hash_bytes: number;
      hash_hex: string;
      device_name: string | null;
      revoked_at: Date | null;
      expires_at: Date;
      expires_type: string;
      browser: string;
    }>(
      `SELECT pg_typeof(token_hash)::text AS hash_type,
              octet_length(token_hash) AS hash_bytes,
              encode(token_hash, 'hex') AS hash_hex,
              device_name,
              revoked_at,
              expires_at,
              pg_typeof(expires_at)::text AS expires_type,
              device ->> 'browser' AS browser
         FROM sessions WHERE id = $1`,
      [sessionId],
    );

    expect(stored.rows).toEqual([
      {
        hash_type: 'bytea',
        hash_bytes: 32,
        hash_hex: HASH,
        device_name: null,
        revoked_at: null,
        expires_at: new Date('2099-01-01T14:00:00.000Z'),
        expires_type: 'timestamp with time zone',
        browser: 'Contract',
      },
    ]);
  });

  it('issues version 7 ids', async () => {
    const userId = await harness.seedAccount();

    expect(userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('reports a server that refuses connections as unavailable', async () => {
    const closedPort = new Pool({
      ...harness.server.connection,
      port: 1,
    });
    const unreachable = openPostgresDatabase(closedPort);
    let workRuns = 0;

    try {
      const failure = await rejectionOf(
        new PostgresUnitOfWorkRunner(unreachable, rerunAtOnce).run(() => {
          workRuns += 1;
          return Promise.resolve();
        }),
      );

      expect({
        unavailable: failure instanceof PersistenceUnavailableError,
        workRuns,
      }).toEqual({ unavailable: true, workRuns: 0 });
    } finally {
      await unreachable.destroy();
    }
  });
});
