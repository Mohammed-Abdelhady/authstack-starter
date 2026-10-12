import { Kysely, sql } from 'kysely';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import {
  CodeGuessKey,
  CodeGuessRule,
  firstGuessState,
} from '../../pending-codes/code-guesses';
import { storedAddress } from './postgres-pending-codes-database';

const MS = sql`interval '1 millisecond'`;
/** A mail window that has long ended, so the first mail starts one at one. */
const NO_MAIL_WINDOW = new Date(0);

/**
 * Counts one guess at the address and purpose unless it is locked, and locks
 * it when this guess is the last one allowed. One statement: a second guess
 * that waited on the row is judged against what the first one stored.
 *
 * @returns False when the address is locked and nothing was counted
 */
export async function reservePostgresGuess(
  database: Kysely<PostgresTables>,
  key: CodeGuessKey,
  now: Date,
  rule: CodeGuessRule,
): Promise<boolean> {
  const first = firstGuessState(now, rule);
  const at = sql`${now}::timestamptz`;
  const remembered = sql`COALESCE(mail_counters.guess_state_expires_at > ${at}, false)`;
  const failed = sql`CASE WHEN ${remembered} THEN mail_counters.failed_guesses ELSE 0 END`;
  const level = sql`CASE WHEN ${remembered} THEN mail_counters.guess_lock_level ELSE 0 END`;
  const locks = sql`(${failed}) + 1 >= ${rule.limit}::integer`;
  const lockMs = sql`LEAST(${rule.lockBaseMs}::double precision * power(2::double precision, ${level}), ${rule.lockMaxMs}::double precision)`;
  const lockEnd = sql`${at} + ${lockMs} * ${MS}`;
  const stateEnd = sql`(CASE WHEN ${locks} THEN ${lockEnd} ELSE ${at} END) + ${rule.memoryMs}::double precision * ${MS}`;

  const counted = await sql<{ id: string }>`
    INSERT INTO mail_counters (
      email, purpose, mailed_codes, window_started_at, expires_at,
      failed_guesses, guess_lock_level, guess_locked_until,
      guess_state_expires_at
    ) VALUES (
      ${storedAddress(key.email)}, ${key.purpose}, 0, ${NO_MAIL_WINDOW},
      ${first.stateExpiresAt}, ${first.failedGuesses}, ${first.lockLevel},
      ${first.lockedUntil}, ${first.stateExpiresAt}
    )
    ON CONFLICT ON CONSTRAINT mail_counter_email_purpose_unique DO UPDATE SET
      failed_guesses = CASE WHEN ${locks} THEN 0 ELSE (${failed}) + 1 END,
      guess_lock_level = CASE
        WHEN ${locks} THEN LEAST((${level}) + 1, ${rule.maxLockLevel}::integer)
        ELSE ${level} END,
      guess_locked_until = CASE WHEN ${locks} THEN ${lockEnd} ELSE NULL END,
      guess_state_expires_at = ${stateEnd},
      expires_at = GREATEST(mail_counters.expires_at, ${stateEnd})
    WHERE NOT (
      ${remembered}
      AND COALESCE(mail_counters.guess_locked_until > ${at}, false)
    )
    RETURNING id`.execute(database);
  return counted.rows.length > 0;
}

/** Forgets the wrong codes and the locks of the address and purpose. */
export async function clearPostgresGuesses(
  database: Kysely<PostgresTables>,
  key: CodeGuessKey,
): Promise<void> {
  await database
    .updateTable('mail_counters')
    .set({
      failed_guesses: 0,
      guess_lock_level: 0,
      guess_locked_until: null,
      guess_state_expires_at: null,
    })
    .where('email', '=', storedAddress(key.email))
    .where('purpose', '=', key.purpose)
    .execute();
}
