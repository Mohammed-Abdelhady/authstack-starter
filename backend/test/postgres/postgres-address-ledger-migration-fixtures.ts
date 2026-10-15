import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PostgresActivationAccounts } from '../../src/auth/persistence/postgres/postgres-activation-accounts';
import { PostgresMailCounterStore } from '../../src/auth/persistence/postgres/postgres-mail-counter.store';
import { PostgresPendingRegistrationStore } from '../../src/auth/persistence/postgres/postgres-pending-registration.store';
import { MailCounterService } from '../../src/auth/services/mail/mail-counter.service';
import { VerificationCodeService } from '../../src/auth/services/codes/verification-code.service';
import { EmailChangeConfirmationService } from '../../src/auth/services/registration/email-change-confirmation.service';
import { PostgresAddressLedger } from '../../src/common/persistence/postgres/postgres-address-ledger';
import { openPostgresDatabase } from '../../src/common/persistence/postgres/postgres-database';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { HashService } from '../../src/common/services/hash.service';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { PostgresSessionRevocationStore } from '../../src/session/persistence/postgres/postgres-session-revocation.store';
import { SessionRevoker } from '../../src/session/revocation/session-revoker';
import { RevokerAccountSessions } from '../../src/user/stores/revoker-account-sessions';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';

export const FIRST_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e51';
export const SECOND_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e52';
export const THIRD_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e53';
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
export const LIVE_EXPIRY = new Date('2099-01-01T13:00:00.000Z');
const EARLIER_EXPIRY = new Date('2099-01-01T12:30:00.000Z');
const EXPIRED = new Date('2000-01-01T00:00:00.000Z');
const FIRST_MATCHING_CODE_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e71';
const NEWEST_MATCHING_CODE_ID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e72';
export const BACKFILL_COUNTS =
  'Address ledger backfill: kept=2 cleared_taken=1 cleared_ambiguous=5 cleared_codeless=4 codes_killed=9';

export async function seedBackfill(pool: Pool): Promise<void> {
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
  const codes: [string, number, number, Date, string?][] = [
    [' taken@EXAMPLE.test ', 1, 1, LIVE_EXPIRY],
    [' SHARED@example.test ', 2, 7, LIVE_EXPIRY, FIRST_MATCHING_CODE_ID],
    ['shared@example.test', 3, 0, LIVE_EXPIRY],
    ['shared@example.test ', 2, 7, EARLIER_EXPIRY],
    [' Shared@Example.Test ', 2, 7, LIVE_EXPIRY, NEWEST_MATCHING_CODE_ID],
    ['stale@example.test', 6, 3, LIVE_EXPIRY],
    ['expired@example.test', 7, 1, EXPIRED],
    [' SOLO@example.test ', 8, 2, LIVE_EXPIRY],
    [' Ambiguous@example.test ', 10, 1, LIVE_EXPIRY],
    ['ambiguous@example.test', 11, 1, LIVE_EXPIRY],
    ['wrong@example.test', 2, 1, LIVE_EXPIRY],
    ['unrelated@example.test', 2, 7, LIVE_EXPIRY],
  ];
  for (const [address, owner, generation, expiry, id] of codes) {
    await pool.query(
      `INSERT INTO pending_registrations
         (id, email, purpose, user_id, address_generation, hashed_code, expires_at)
       VALUES (COALESCE($1::uuid, uuidv7()), $2, 'email-change', $3, $4,
               'legacy-hash', $5)`,
      [id ?? null, address, USER_IDS[owner], generation, expiry],
    );
  }
  await pool.query(
    `INSERT INTO pending_registrations
       (email, purpose, hashed_code, expires_at)
     VALUES (' taken@EXAMPLE.test ', 'signup', 'signup-hash', $1)`,
    [LIVE_EXPIRY],
  );
}

export async function expectBackfilled(pool: Pool): Promise<void> {
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
      lapses_at: LIVE_EXPIRY,
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
    { email: ' taken@EXAMPLE.test ', purpose: 'signup' },
    { email: 'shared@example.test', purpose: 'email-change' },
    { email: 'solo@example.test', purpose: 'email-change' },
    { email: 'unrelated@example.test', purpose: 'email-change' },
  ]);
  const selected = await pool.query<{
    id: string;
    user_id: string;
    address_generation: number;
    expires_at: Date;
  }>(
    `SELECT id, user_id, address_generation, expires_at
       FROM pending_registrations
      WHERE email = 'shared@example.test' AND purpose = 'email-change'`,
  );
  expect(selected.rows).toEqual([
    {
      id: NEWEST_MATCHING_CODE_ID,
      user_id: THIRD_ID,
      address_generation: 7,
      expires_at: LIVE_EXPIRY,
    },
  ]);
}

export function migrationConfirmationService(pool: Pool) {
  const database = openPostgresDatabase(pool);
  const clock = new FrozenClock(TEST_NOW);
  const config = new ConfigService({
    activation: { maxAttempts: 5, codeExpiresIn: 900_000 },
    bcrypt: { rounds: 4 },
  });
  const hash = new HashService(config);
  const runner = new PostgresUnitOfWorkRunner(database);
  const verification = new VerificationCodeService(
    new PostgresPendingRegistrationStore(database),
    hash,
    config,
    clock,
    new MailCounterService(
      new PostgresMailCounterStore(database),
      config,
      clock,
    ),
  );
  return {
    hash,
    service: new EmailChangeConfirmationService(
      new PostgresActivationAccounts(database, clock),
      runner,
      verification,
      new RevokerAccountSessions(
        new SessionRevoker(
          runner,
          new PostgresSessionRevocationStore(
            clock,
            new PostgresSecurityEventStore(database),
          ),
          clock,
        ),
      ),
      new PostgresAddressLedger(),
      clock,
    ),
  };
}
