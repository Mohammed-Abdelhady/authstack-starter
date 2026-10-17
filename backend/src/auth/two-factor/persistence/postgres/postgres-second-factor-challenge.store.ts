import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { Kysely } from 'kysely';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import {
  ChallengeClaimLimits,
  NewSecondFactorChallenge,
  SECOND_FACTOR_CHALLENGE_CONSTRAINT,
  SecondFactorChallengeKey,
  SecondFactorChallengeStore,
  StoredSecondFactorChallenge,
} from '../../stores/second-factor-challenge.store';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import { autocommit } from '../../../persistence/postgres/postgres-pending-codes-database';

/** Constraint names of the table to the rules' shared names. */
const CHALLENGE_CONSTRAINTS: Readonly<Record<string, string>> = {
  two_factor_challenge_nonce_unique: SECOND_FACTOR_CHALLENGE_CONSTRAINT.NONCE,
};

const CHALLENGE_COLUMNS = ['id', 'user_id', 'attempts', 'expires_at'] as const;

function toStoredChallenge(row: {
  id: string;
  user_id: string;
  attempts: number;
  expires_at: Date;
}): StoredSecondFactorChallenge {
  return {
    id: row.id,
    userId: row.user_id,
    attempts: row.attempts,
    expiresAt: row.expires_at,
  };
}

/**
 * One row per challenge. The table has nothing that expires rows, so the
 * expiry comparison in `claim` is the only thing that refuses a lapsed one.
 */
export class PostgresSecondFactorChallengeStore extends SecondFactorChallengeStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  isAccountId(id: string): boolean {
    try {
      toUuid(id);
      return true;
    } catch (error) {
      if (error instanceof MalformedIdError) return false;
      throw error;
    }
  }

  open(challenge: NewSecondFactorChallenge): Promise<void> {
    return autocommit(CHALLENGE_CONSTRAINTS, async () => {
      await this.database
        .insertInto('two_factor_challenges')
        .values({
          user_id: toUuid(challenge.userId),
          nonce_hash: challenge.nonceHash,
          expires_at: challenge.expiresAt,
        })
        .execute();
    });
  }

  async openIn(
    work: UnitOfWork,
    challenge: NewSecondFactorChallenge,
  ): Promise<void> {
    await postgresTransactionOf(work)
      .insertInto('two_factor_challenges')
      .values({
        user_id: toUuid(challenge.userId),
        nonce_hash: challenge.nonceHash,
        expires_at: challenge.expiresAt,
      })
      .execute();
  }

  find(
    key: SecondFactorChallengeKey,
  ): Promise<StoredSecondFactorChallenge | null> {
    return autocommit(CHALLENGE_CONSTRAINTS, async () => {
      const row = await this.database
        .selectFrom('two_factor_challenges')
        .select(CHALLENGE_COLUMNS)
        .where('nonce_hash', '=', key.nonceHash)
        .where('user_id', '=', toUuid(key.userId))
        .executeTakeFirst();
      return row ? toStoredChallenge(row) : null;
    });
  }

  claim(
    key: SecondFactorChallengeKey,
    limits: ChallengeClaimLimits,
  ): Promise<StoredSecondFactorChallenge | null> {
    return autocommit(CHALLENGE_CONSTRAINTS, async () => {
      const row = await this.database
        .updateTable('two_factor_challenges')
        .set({ claimed_at: limits.now })
        .where('nonce_hash', '=', key.nonceHash)
        .where('user_id', '=', toUuid(key.userId))
        .where('expires_at', '>', limits.now)
        .where('attempts', '<', limits.maxAttempts)
        .where('claimed_at', 'is', null)
        .returning(CHALLENGE_COLUMNS)
        .executeTakeFirst();
      return row ? toStoredChallenge(row) : null;
    });
  }

  countFailure(challengeId: string): Promise<{ attempts: number } | null> {
    return autocommit(CHALLENGE_CONSTRAINTS, async () => {
      const row = await this.database
        .updateTable('two_factor_challenges')
        .set((challenge) => ({
          attempts: challenge('attempts', '+', 1),
          claimed_at: null,
        }))
        .where('id', '=', toUuid(challengeId))
        .returning('attempts')
        .executeTakeFirst();
      return row ? { attempts: row.attempts } : null;
    });
  }

  discard(challengeId: string): Promise<void> {
    return autocommit(CHALLENGE_CONSTRAINTS, async () => {
      await this.database
        .deleteFrom('two_factor_challenges')
        .where('id', '=', toUuid(challengeId))
        .execute();
    });
  }
}
