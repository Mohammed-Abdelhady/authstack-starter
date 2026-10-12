import { Kysely } from 'kysely';
import {
  PASSWORD_RESET_CONSTRAINT,
  PasswordResetClaim,
  PasswordResetCodeStore,
  PasswordResetGeneration,
  ReservedPasswordResetAttempt,
} from '../../pending-codes/password-reset-code.store';
import {
  AttemptRule,
  CODE_CLAIM,
  CODE_ROTATION,
  CodeClaim,
  CodeRotation,
} from '../../pending-codes/pending-registration.store';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  autocommit,
  removedRows,
  storedAddress,
} from './postgres-pending-codes-database';
import { MAIL_COUNTER_PURPOSE } from '../../constants/registration';
import {
  clearPostgresGuesses,
  reservePostgresGuess,
} from './postgres-code-guesses';

const CONSTRAINTS = {
  pending_password_reset_email_unique: PASSWORD_RESET_CONSTRAINT.ADDRESS,
} as const;

const NONE = {} as const;
const PURPOSE = MAIL_COUNTER_PURPOSE.PASSWORD_RESET;

export class PostgresPasswordResetCodeStore extends PasswordResetCodeStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  rotateCode(
    email: string,
    generation: PasswordResetGeneration,
  ): Promise<CodeRotation> {
    return autocommit(NONE, async () => {
      const rotated = await this.database
        .updateTable('pending_password_resets')
        .set({
          hashed_code: generation.hashedCode,
          attempts: 0,
          expires_at: generation.expiresAt,
        })
        .where('email', '=', storedAddress(email))
        .returning('id')
        .executeTakeFirst();
      return rotated ? CODE_ROTATION.ROTATED : CODE_ROTATION.NO_MATCHING_RECORD;
    });
  }

  async insertRecord(
    email: string,
    generation: PasswordResetGeneration,
  ): Promise<void> {
    await autocommit(CONSTRAINTS, () =>
      this.database
        .insertInto('pending_password_resets')
        .values({
          email: storedAddress(email),
          hashed_code: generation.hashedCode,
          attempts: 0,
          expires_at: generation.expiresAt,
        })
        .execute(),
    );
  }

  reserveAttempt(
    email: string,
    rule: AttemptRule,
  ): Promise<ReservedPasswordResetAttempt | null> {
    return autocommit(NONE, async () => {
      const row = await this.database
        .updateTable('pending_password_resets')
        .set((column) => ({ attempts: column('attempts', '+', 1) }))
        .where('email', '=', storedAddress(email))
        .where('expires_at', '>', rule.now)
        .where('attempts', '<', rule.maxAttempts)
        .returning(['id', 'hashed_code'])
        .executeTakeFirst();
      if (!row) {
        return null;
      }
      const counted = await reservePostgresGuess(
        this.database,
        { email, purpose: PURPOSE },
        rule.now,
        rule.guesses,
      );
      return counted ? { id: row.id, hashedCode: row.hashed_code } : null;
    });
  }

  claimCode(claim: PasswordResetClaim): Promise<CodeClaim> {
    return autocommit(NONE, async () => {
      const claimed = await this.database
        .deleteFrom('pending_password_resets')
        .where('id', '=', toUuid(claim.id))
        .where('hashed_code', '=', claim.hashedCode)
        .where('expires_at', '>', claim.now)
        .returning('email')
        .executeTakeFirst();
      if (!claimed) {
        return CODE_CLAIM.NOT_CLAIMABLE;
      }
      await clearPostgresGuesses(this.database, {
        email: claimed.email,
        purpose: PURPOSE,
      });
      return CODE_CLAIM.CLAIMED;
    });
  }

  async dropExpiredRecord(email: string, now: Date): Promise<void> {
    await autocommit(NONE, () =>
      this.database
        .deleteFrom('pending_password_resets')
        .where('email', '=', storedAddress(email))
        .where('expires_at', '<=', now)
        .execute(),
    );
  }

  deleteExpiredBefore(cutoff: Date): Promise<number> {
    return autocommit(NONE, async () =>
      removedRows(
        await this.database
          .deleteFrom('pending_password_resets')
          .where('expires_at', '<=', cutoff)
          .executeTakeFirstOrThrow(),
      ),
    );
  }
}
