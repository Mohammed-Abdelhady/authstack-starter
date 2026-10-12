import { Kysely, sql } from 'kysely';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { PENDING_PURPOSE } from '../../constants/registration';
import {
  AttemptRule,
  CODE_CLAIM,
  CODE_ROTATION,
  CodeClaim,
  CodeRotation,
  LEGACY_BLOCKER,
  LegacyBlocker,
  PENDING_REGISTRATION_CONSTRAINT,
  PendingCodeGeneration,
  PendingRegistrationKey,
  PendingRegistrationStore,
  RegistrationCodeClaim,
  ReservedRegistrationAttempt,
} from '../../pending-codes/pending-registration.store';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  autocommit,
  removedRows,
  storedAddress,
} from './postgres-pending-codes-database';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

const CONSTRAINTS = {
  pending_registration_email_purpose_unique:
    PENDING_REGISTRATION_CONSTRAINT.ADDRESS_PURPOSE,
} as const;

const NONE = {} as const;

/** The columns a new generation writes. An email change also re-points it. */
function generationColumns(generation: PendingCodeGeneration) {
  const columns = {
    hashed_code: generation.hashedCode,
    attempts: 0,
    expires_at: generation.expiresAt,
  };
  if (generation.userId === undefined) {
    return columns;
  }
  return {
    ...columns,
    user_id: toUuid(generation.userId),
    address_generation: generation.addressGeneration ?? 0,
  };
}

export class PostgresPendingRegistrationStore extends PendingRegistrationStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  rotateLiveCode(
    key: PendingRegistrationKey,
    now: Date,
    generation: PendingCodeGeneration,
  ): Promise<CodeRotation> {
    return this.rotate(key, generation, '>', now);
  }

  replaceExpiredCode(
    key: PendingRegistrationKey,
    now: Date,
    generation: PendingCodeGeneration,
  ): Promise<CodeRotation> {
    return this.rotate(key, generation, '<=', now);
  }

  /** The answer is the returned row, never the driver's count of matches. */
  private rotate(
    key: PendingRegistrationKey,
    generation: PendingCodeGeneration,
    expiry: '>' | '<=',
    now: Date,
  ): Promise<CodeRotation> {
    return autocommit(NONE, async () => {
      let update = this.database
        .updateTable('pending_registrations')
        .set(generationColumns(generation))
        .where('email', '=', storedAddress(key.email))
        .where('purpose', '=', key.purpose)
        .where('expires_at', expiry, now);
      if (
        key.purpose === PENDING_PURPOSE.EMAIL_CHANGE &&
        generation.userId !== undefined &&
        generation.addressGeneration !== undefined
      ) {
        const userId = toUuid(generation.userId);
        update = update.where(
          sql<boolean>`(user_id IS DISTINCT FROM ${userId} OR address_generation <= ${generation.addressGeneration})`,
        );
      }
      const rotated = await update.returning('id').executeTakeFirst();
      return rotated ? CODE_ROTATION.ROTATED : CODE_ROTATION.NO_MATCHING_RECORD;
    });
  }

  hasRecord(key: PendingRegistrationKey): Promise<boolean> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .selectFrom('pending_registrations')
        .select('id')
        .where('email', '=', storedAddress(key.email))
        .where('purpose', '=', key.purpose)
        .executeTakeFirst();
      return row !== undefined;
    });
  }

  async dropExpiredRecord(
    key: PendingRegistrationKey,
    now: Date,
  ): Promise<void> {
    await autocommit(NONE, () =>
      this.database
        .deleteFrom('pending_registrations')
        .where('email', '=', storedAddress(key.email))
        .where('purpose', '=', key.purpose)
        .where('expires_at', '<=', now)
        .execute(),
    );
  }

  async insertRecord(
    key: PendingRegistrationKey,
    generation: PendingCodeGeneration,
  ): Promise<void> {
    await autocommit(CONSTRAINTS, () =>
      this.database
        .insertInto('pending_registrations')
        .values({
          email: storedAddress(key.email),
          purpose: key.purpose,
          hashed_code: generation.hashedCode,
          attempts: 0,
          expires_at: generation.expiresAt,
          user_id:
            generation.userId === undefined ? null : toUuid(generation.userId),
          address_generation: generation.addressGeneration ?? null,
        })
        .execute(),
    );
  }

  /**
   * No record without a purpose can exist: the purpose column is never null.
   * So nothing can block an insert but a record of the same purpose, and the
   * caller's next pass refreshes that one.
   */
  clearLegacyBlocker(): Promise<LegacyBlocker> {
    return Promise.resolve(LEGACY_BLOCKER.CLEARED);
  }

  reserveAttempt(
    key: PendingRegistrationKey,
    rule: AttemptRule,
  ): Promise<ReservedRegistrationAttempt | null> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .updateTable('pending_registrations')
        .set((column) => ({ attempts: column('attempts', '+', 1) }))
        .where('email', '=', storedAddress(key.email))
        .where('purpose', '=', key.purpose)
        .where('expires_at', '>', rule.now)
        .where('attempts', '<', rule.maxAttempts)
        .returning([
          'id',
          'email',
          'hashed_code',
          'user_id',
          'address_generation',
        ])
        .executeTakeFirst();
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        email: row.email,
        hashedCode: row.hashed_code,
        userId: row.user_id ?? undefined,
        addressGeneration: row.address_generation ?? undefined,
      };
    });
  }

  async claimCode(
    unitOfWork: UnitOfWork,
    claim: RegistrationCodeClaim,
  ): Promise<CodeClaim> {
    const claimed = await postgresTransactionOf(unitOfWork)
      .deleteFrom('pending_registrations')
      .where('id', '=', toUuid(claim.id))
      .where('purpose', '=', claim.purpose)
      .where('hashed_code', '=', claim.hashedCode)
      .where('expires_at', '>', claim.now)
      .returning('id')
      .executeTakeFirst();
    return claimed ? CODE_CLAIM.CLAIMED : CODE_CLAIM.NOT_CLAIMABLE;
  }

  deleteExpiredBefore(cutoff: Date): Promise<number> {
    return autocommit(NONE, async () =>
      removedRows(
        await this.database
          .deleteFrom('pending_registrations')
          .where('expires_at', '<=', cutoff)
          .executeTakeFirstOrThrow(),
      ),
    );
  }
}
