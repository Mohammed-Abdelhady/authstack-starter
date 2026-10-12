import { Kysely } from 'kysely';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import {
  CHALLENGE_USE,
  ChallengeUse,
  NewPasskeyChallenge,
  PASSKEY_CHALLENGE_CONSTRAINT,
  PasskeyChallengeKey,
  PasskeyChallengeStore,
} from '../../stores/passkey-challenge.store';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  autocommit,
  removedRows,
} from '../../../persistence/postgres/postgres-pending-codes-database';

/** Constraint names of the table to the rules' shared names. */
const CHALLENGE_CONSTRAINTS: Readonly<Record<string, string>> = {
  passkey_challenge_hash_unique: PASSKEY_CHALLENGE_CONSTRAINT.CHALLENGE,
};

/** The stored id, or null for one this database could not have issued. */
function ownId(id: string | undefined): string | null {
  if (!id) return null;
  try {
    return toUuid(id);
  } catch (error) {
    if (error instanceof MalformedIdError) return null;
    throw error;
  }
}

/**
 * One row per challenge. The table has nothing that expires rows, so the
 * expiry comparison in `consume` is the only thing that refuses a lapsed one.
 */
export class PostgresPasskeyChallengeStore extends PasskeyChallengeStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  open(challenge: NewPasskeyChallenge): Promise<void> {
    return autocommit(CHALLENGE_CONSTRAINTS, async () => {
      await this.database
        .insertInto('passkey_challenges')
        .values({
          challenge_hash: challenge.challengeHash,
          purpose: challenge.purpose,
          user_id: ownId(challenge.userId),
          expires_at: challenge.expiresAt,
        })
        .execute();
    });
  }

  consume(key: PasskeyChallengeKey, now: Date): Promise<ChallengeUse> {
    return autocommit(CHALLENGE_CONSTRAINTS, async () => {
      const spent = await this.database
        .deleteFrom('passkey_challenges')
        .where('challenge_hash', '=', key.challengeHash)
        .where('purpose', '=', key.purpose)
        .where('expires_at', '>', now)
        .executeTakeFirst();
      return removedRows(spent) === 1
        ? CHALLENGE_USE.CONSUMED
        : CHALLENGE_USE.REFUSED;
    });
  }
}
