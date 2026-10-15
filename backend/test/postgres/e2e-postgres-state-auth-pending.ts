import { storedAddress } from '../../src/auth/persistence/postgres/postgres-pending-codes-database';
import type { PostgresDatabase } from '../../src/common/persistence/postgres/postgres-connection';
import type {
  E2ePendingCodeState,
  E2ePendingRegistration,
} from '../utils/e2e-state-auth';
import { mailCounterRecord } from '../utils/mail-counter-seed';

const REGISTRATION_COLUMNS = [
  'purpose',
  'hashed_code',
  'attempts',
  'address_generation',
] as const;

interface RegistrationRow {
  purpose: string;
  hashed_code: string;
  attempts: number;
  address_generation: number | null;
}

function pendingRegistration(row: RegistrationRow): E2ePendingRegistration {
  return {
    purpose: row.purpose,
    hashedCode: row.hashed_code,
    attempts: row.attempts,
    addressGeneration: row.address_generation ?? undefined,
  };
}

/** `hashed_code` as `hashedCode`: the name the record gives the field. */
function fieldName(column: string): string {
  return column.replace(/_([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

/** Mailed codes on PostgreSQL, through the adapter's table map. */
export function postgresPendingCodeState(
  database: PostgresDatabase,
): E2ePendingCodeState {
  const registrationsFor = async (
    email: string,
  ): Promise<E2ePendingRegistration[]> => {
    const rows = await database
      .selectFrom('pending_registrations')
      .select(REGISTRATION_COLUMNS)
      .where('email', '=', storedAddress(email))
      .execute();
    return rows.map(pendingRegistration);
  };

  return {
    countAddressClaims: async (address) => {
      const row = await database
        .selectFrom('address_claims')
        .select((select) => select.fn.countAll<string>().as('count'))
        .where('address', '=', storedAddress(address))
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },
    storePendingRegistration: async (record) => {
      await database
        .insertInto('pending_registrations')
        .values({
          email: storedAddress(record.email),
          purpose: record.purpose,
          hashed_code: record.hashedCode,
          attempts: record.attempts,
          expires_at: record.expiresAt,
          user_id: record.userId ?? null,
          address_generation: record.addressGeneration ?? null,
        })
        .execute();
    },
    pendingRegistrationFor: async (email) =>
      (await registrationsFor(email))[0] ?? null,
    storedPendingRegistrationFields: async (email) => {
      const row = await database
        .selectFrom('pending_registrations')
        .selectAll()
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      if (!row) return null;
      return Object.fromEntries(
        Object.entries(row).map(([column, value]) => [
          fieldName(column),
          value,
        ]),
      );
    },
    countPendingRegistrations: async (email, purpose) => {
      const records = await registrationsFor(email);
      return purpose === undefined
        ? records.length
        : records.filter((record) => record.purpose === purpose).length;
    },
    removePendingRegistration: async (email) => {
      const one = await database
        .selectFrom('pending_registrations')
        .select('id')
        .where('email', '=', storedAddress(email))
        .limit(1)
        .executeTakeFirst();
      if (!one) return;
      await database
        .deleteFrom('pending_registrations')
        .where('id', '=', one.id)
        .execute();
    },
    removeEveryPendingRegistration: async (email) => {
      await database
        .deleteFrom('pending_registrations')
        .where('email', '=', storedAddress(email))
        .execute();
    },
    replacePendingRegistrationCode: async (email, code) => {
      await database
        .updateTable('pending_registrations')
        .set({
          purpose: code.purpose,
          hashed_code: code.hashedCode,
          attempts: code.attempts,
          expires_at: code.expiresAt,
        })
        .where('email', '=', storedAddress(email))
        .execute();
    },

    storePendingPasswordReset: async (record) => {
      await database
        .insertInto('pending_password_resets')
        .values({
          email: storedAddress(record.email),
          hashed_code: record.hashedCode,
          attempts: record.attempts,
          expires_at: record.expiresAt,
        })
        .execute();
    },
    pendingPasswordResetFor: async (email) => {
      const row = await database
        .selectFrom('pending_password_resets')
        .select(['hashed_code', 'attempts'])
        .where('email', '=', storedAddress(email))
        .executeTakeFirst();
      return row
        ? { hashedCode: row.hashed_code, attempts: row.attempts }
        : null;
    },
    countPendingPasswordResets: async (email) => {
      const rows = await database
        .selectFrom('pending_password_resets')
        .select('id')
        .where('email', '=', storedAddress(email))
        .execute();
      return rows.length;
    },
    removePendingPasswordReset: async (email) => {
      await database
        .deleteFrom('pending_password_resets')
        .where('email', '=', storedAddress(email))
        .execute();
    },
    replacePendingPasswordResetCode: async (email, code) => {
      await database
        .updateTable('pending_password_resets')
        .set({
          hashed_code: code.hashedCode,
          attempts: code.attempts,
          expires_at: code.expiresAt,
        })
        .where('email', '=', storedAddress(email))
        .execute();
    },

    storeMailCounter: async (seed) => {
      const counter = mailCounterRecord(seed);
      await database
        .insertInto('mail_counters')
        .values({
          email: storedAddress(counter.email),
          purpose: counter.purpose,
          mailed_codes: counter.mailedCodes,
          window_started_at: counter.windowStartedAt,
          expires_at: counter.expiresAt,
        })
        .execute();
    },
    mailCounterFor: async (email, purpose) => {
      const row = await database
        .selectFrom('mail_counters')
        .select('mailed_codes')
        .where('email', '=', storedAddress(email))
        .where('purpose', '=', purpose)
        .executeTakeFirst();
      return row ? { mailedCodes: row.mailed_codes } : null;
    },
    // feature:magic-link:start
    storeMagicLinks: async (links) => {
      await database
        .insertInto('pending_magic_links')
        .values(
          links.map((link) => ({
            email: storedAddress(link.email),
            token_hash: link.tokenHash,
            expires_at: link.expiresAt,
            consumed_at: link.consumedAt,
            created_at: link.createdAt,
          })),
        )
        .execute();
    },
    expireMagicLinks: async () => {
      await database
        .updateTable('pending_magic_links')
        .set({ expires_at: new Date(0) })
        .execute();
    },
    // feature:magic-link:end
  };
}
