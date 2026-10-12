import { MongoNetworkError } from 'mongodb';
import { Connection, Model } from 'mongoose';
import { SecurityEventDocument } from '../../src/session/persistence/mongo/schemas/security-event.schema';
import { UNKNOWN_COMMIT_RESULT_LABEL } from '../../src/common/persistence/mongo/mongo-transaction';
import { UserDocument } from '../../src/user/persistence/mongo/schemas/user.schema';
import { RaceGate } from './race-gate';
import {
  issueOnlyTheRefusedEventId,
  REFUSED_EVENT_ID,
  REFUSED_EVENT_SEED_ACTION,
  REFUSED_EVENT_SEED_OUTCOME,
} from './refused-event';

export { REFUSED_EVENT_SEED_ACTION };

/** Fail at the database boundary after the account write, before revocation. */
export function failNextVersionWrite(
  users: Model<UserDocument>,
  error: Error,
  gate?: RaceGate,
): () => void {
  const update = users.collection.updateOne.bind(users.collection);
  let failed = false;
  const spy = jest
    .spyOn(users.collection, 'updateOne')
    .mockImplementation(async (...args: Parameters<typeof update>) => {
      const document = args[1];
      const increment: unknown = Array.isArray(document)
        ? undefined
        : document.$inc;
      if (
        !failed &&
        increment !== null &&
        typeof increment === 'object' &&
        'sessionVersion' in increment
      ) {
        failed = true;
        await gate?.hold();
        throw error;
      }
      return update(...args);
    });
  return () => spy.mockRestore();
}

/**
 * Make the database refuse every security event until restored. A stored event
 * already owns the id the next ones are given, so the unique constraint rejects
 * the insert inside the caller's real transaction. Only randomness is replaced.
 */
export async function refuseSecurityEvents(
  events: Model<SecurityEventDocument>,
  occurredAt: Date,
): Promise<() => void> {
  await events.updateOne(
    { eventId: REFUSED_EVENT_ID },
    {
      $setOnInsert: {
        action: REFUSED_EVENT_SEED_ACTION,
        outcome: REFUSED_EVENT_SEED_OUTCOME,
        occurredAt,
      },
    },
    { upsert: true },
  );
  return issueOnlyTheRefusedEventId();
}

export interface LostCommitAnswers {
  commitAttempts: () => number;
  restore: () => void;
}

/**
 * Lose the answer to the next `times` commits on this connection. With `lands`
 * the real commit runs first and only its reply is lost; without it the commit
 * never reaches the database. Later commits go through untouched.
 */
export function loseCommitAnswers(
  connection: Connection,
  options: { lands: boolean; times: number },
): LostCommitAnswers {
  const startSession = connection.startSession.bind(connection);
  let lost = 0;
  let attempts = 0;
  const spy = jest
    .spyOn(connection, 'startSession')
    .mockImplementation(async (sessionOptions) => {
      const session = await startSession(sessionOptions);
      const commit = session.commitTransaction.bind(session);
      jest.spyOn(session, 'commitTransaction').mockImplementation(async () => {
        attempts += 1;
        if (lost >= options.times) {
          return commit();
        }
        lost += 1;
        if (options.lands) {
          await commit();
        }
        const failure = new MongoNetworkError('the commit reply was lost');
        failure.addErrorLabel(UNKNOWN_COMMIT_RESULT_LABEL);
        throw failure;
      });
      return session;
    });
  return { commitAttempts: () => attempts, restore: () => spy.mockRestore() };
}
