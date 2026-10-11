import { randomUUID } from 'node:crypto';
import { Kysely } from 'kysely';
import { PendingCodesContractHarness } from '../utils/auth/pending-codes-contract/pending-codes-contract-harness';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import { PostgresTables } from '../../src/common/persistence/postgres/postgres-database';
import { PostgresMailCounterStore } from '../../src/auth/persistence/postgres/postgres-mail-counter.store';
import { PostgresPasswordResetCodeStore } from '../../src/auth/persistence/postgres/postgres-password-reset-code.store';
import { PostgresPendingRegistrationStore } from '../../src/auth/persistence/postgres/postgres-pending-registration.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { openTestConnection } from './postgres-connection';
import { PostgresTestServer } from './server/postgres-test-server';

const AN_OBJECT_ID = '65f000000000000000000001';

export interface PostgresPendingCodesHarness extends PendingCodesContractHarness {
  readonly database: Kysely<PostgresTables>;
  readonly server: PostgresTestServer;
}

const purposeOf = <Purpose extends string>(
  value: string,
  purposes: readonly Purpose[],
): Purpose => {
  const purpose = purposes.find((candidate) => candidate === value);
  if (!purpose) {
    throw new Error(`an unknown purpose is stored: ${value}`);
  }
  return purpose;
};

const MAIL_PURPOSES = [
  'signup',
  'email-change',
  'notice',
  'password-reset',
] as const;
const PENDING_PURPOSES = ['signup', 'email-change'] as const;

export async function bootPostgresPendingCodesHarness(): Promise<PostgresPendingCodesHarness> {
  const connection = await openTestConnection();
  const { server, database } = connection;
  const clock = new FrozenClock(TEST_NOW);

  return {
    database,
    server,
    clock,
    stores: {
      mailCounters: new PostgresMailCounterStore(database),
      registrations: new PostgresPendingRegistrationStore(database),
      passwordResets: new PostgresPasswordResetCodeStore(database),
    },
    runner: (pause) => new PostgresUnitOfWorkRunner(database, pause),

    seedCounter: async (counter) => {
      await database
        .insertInto('mail_counters')
        .values({
          email: counter.email,
          purpose: counter.purpose,
          mailed_codes: counter.mailedCodes,
          window_started_at: counter.windowStartedAt,
          expires_at: counter.expiresAt,
        })
        .execute();
    },
    counter: async (email, purpose) => {
      const row = await database
        .selectFrom('mail_counters')
        .selectAll()
        .where('email', '=', email)
        .where('purpose', '=', purpose)
        .executeTakeFirst();
      return row
        ? {
            email: row.email,
            purpose: purposeOf(row.purpose, MAIL_PURPOSES),
            mailedCodes: row.mailed_codes,
            windowStartedAt: row.window_started_at,
            expiresAt: row.expires_at,
          }
        : null;
    },
    counterCount: () => countRows(database, 'mail_counters'),

    seedRegistration: async (record) => {
      const row = await database
        .insertInto('pending_registrations')
        .values({
          email: record.email,
          purpose: record.purpose,
          hashed_code: record.hashedCode,
          attempts: record.attempts,
          expires_at: record.expiresAt,
          user_id: record.userId ?? null,
          address_generation: record.addressGeneration ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    registration: async (email, purpose) => {
      const row = await database
        .selectFrom('pending_registrations')
        .selectAll()
        .where('email', '=', email)
        .where('purpose', '=', purpose)
        .executeTakeFirst();
      return row
        ? {
            id: row.id,
            email: row.email,
            purpose: purposeOf(row.purpose, PENDING_PURPOSES),
            hashedCode: row.hashed_code,
            attempts: row.attempts,
            expiresAt: row.expires_at,
            userId: row.user_id,
            addressGeneration: row.address_generation,
          }
        : null;
    },
    registrationCount: () => countRows(database, 'pending_registrations'),

    seedPasswordReset: async (record) => {
      const row = await database
        .insertInto('pending_password_resets')
        .values({
          email: record.email,
          hashed_code: record.hashedCode,
          attempts: record.attempts,
          expires_at: record.expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    passwordReset: async (email) => {
      const row = await database
        .selectFrom('pending_password_resets')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst();
      return row
        ? {
            id: row.id,
            email: row.email,
            hashedCode: row.hashed_code,
            attempts: row.attempts,
            expiresAt: row.expires_at,
          }
        : null;
    },
    passwordResetCount: () => countRows(database, 'pending_password_resets'),

    accountId: () => randomUUID(),
    foreignId: () => AN_OBJECT_ID,

    reset: connection.reset,
    close: connection.close,
  };
}

async function countRows(
  database: Kysely<PostgresTables>,
  table: 'mail_counters' | 'pending_registrations' | 'pending_password_resets',
): Promise<number> {
  const row = await database
    .selectFrom(table)
    .select((select) => select.fn.countAll<string>().as('rows'))
    .executeTakeFirstOrThrow();
  return Number(row.rows);
}
