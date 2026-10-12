import { ClientSession, Model, PipelineStage } from 'mongoose';
import { isMongoDuplicateKeyError } from '../../../common/persistence/mongo/mongo-error.util';
import { singleStatement } from '../../../common/persistence/mongo/mongo-unique-conflict';
import { PENDING_STORE_PASSES } from '../../constants/pending-store';
import {
  CodeGuessKey,
  CodeGuessRule,
  isGuessLocked,
} from '../../pending-codes/code-guesses';
import { MailCounterDocument } from './schemas/mail-counter.schema';

/** A mail window that has long ended, so the first mail starts one at one. */
const NO_MAIL_WINDOW = new Date(0);
const NEVER = new Date(0);

type Expression = Record<string, unknown> | string | number | Date | null;

const when = (
  condition: Expression,
  then: Expression,
  otherwise: Expression,
): Expression => ({ $cond: [condition, then, otherwise] });

/**
 * The update that counts one guess, written against the document as it was.
 * A locked document is set to itself, so the caller reads the lock from the
 * document the statement found.
 */
function countGuess(now: Date, rule: CodeGuessRule): PipelineStage.Set {
  const remembered = {
    $gt: [{ $ifNull: ['$guessStateExpiresAt', NEVER] }, now],
  };
  const locked = {
    $and: [
      remembered,
      { $gt: [{ $ifNull: ['$guessLockedUntil', NEVER] }, now] },
    ],
  };
  const failed = when(remembered, { $ifNull: ['$failedGuesses', 0] }, 0);
  const level = when(remembered, { $ifNull: ['$guessLockLevel', 0] }, 0);
  const counted = { $add: [failed, 1] };
  const locks = { $gte: [counted, rule.limit] };
  const lockEnd = {
    $add: [
      now,
      {
        $min: [
          { $multiply: [rule.lockBaseMs, { $pow: [2, level] }] },
          rule.lockMaxMs,
        ],
      },
    ],
  };
  const stateEnd = { $add: [when(locks, lockEnd, now), rule.memoryMs] };
  const unlessLocked = (field: string, next: Expression): Expression =>
    when(locked, `$${field}`, next);

  return {
    $set: {
      failedGuesses: unlessLocked('failedGuesses', when(locks, 0, counted)),
      guessLockLevel: unlessLocked(
        'guessLockLevel',
        when(locks, { $min: [{ $add: [level, 1] }, rule.maxLockLevel] }, level),
      ),
      guessLockedUntil: unlessLocked(
        'guessLockedUntil',
        when(locks, lockEnd, null),
      ),
      guessStateExpiresAt: unlessLocked('guessStateExpiresAt', stateEnd),
      expiresAt: unlessLocked('expiresAt', { $max: ['$expiresAt', stateEnd] }),
      mailedCodes: { $ifNull: ['$mailedCodes', 0] },
      windowStartedAt: { $ifNull: ['$windowStartedAt', NO_MAIL_WINDOW] },
    },
  };
}

/**
 * Counts one guess at the address and purpose unless it is locked, and locks
 * it when this guess is the last one allowed. One statement, so guesses sent
 * at once are each judged against what the one before stored. Two first
 * guesses can both try to create the document: the one refused by the unique
 * index goes around once more and counts on the document that won.
 *
 * @returns False when the address is locked and nothing was counted
 */
export async function reserveMongoGuess(
  counters: Model<MailCounterDocument>,
  key: CodeGuessKey,
  now: Date,
  rule: CodeGuessRule,
): Promise<boolean> {
  for (let pass = 0; pass < PENDING_STORE_PASSES; pass += 1) {
    try {
      const before = await singleStatement(() =>
        counters
          .findOneAndUpdate(
            { email: { $eq: key.email }, purpose: key.purpose },
            [countGuess(now, rule)],
            { new: false, upsert: true },
          )
          .lean()
          .exec(),
      );
      return !isGuessLocked(
        before
          ? {
              lockedUntil: before.guessLockedUntil ?? null,
              stateExpiresAt: before.guessStateExpiresAt ?? null,
            }
          : null,
        now,
      );
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) throw error;
    }
  }
  return false;
}

/** Forgets the wrong codes and the locks of the address and purpose. */
export async function clearMongoGuesses(
  counters: Model<MailCounterDocument>,
  key: CodeGuessKey,
  session?: ClientSession,
): Promise<void> {
  await counters.updateOne(
    { email: { $eq: key.email }, purpose: key.purpose },
    {
      $set: { failedGuesses: 0, guessLockLevel: 0 },
      $unset: { guessLockedUntil: '', guessStateExpiresAt: '' },
    },
    { session },
  );
}
