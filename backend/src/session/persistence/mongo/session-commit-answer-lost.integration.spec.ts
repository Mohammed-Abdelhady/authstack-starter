import { WEB_CLIENT_ID } from '../../constants/client-ids';
import { getModelToken } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import {
  SecurityEvent,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { withMajorityTransaction } from '../../../common/persistence/mongo/mongo-transaction';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';
import {
  LostCommitAnswers,
  loseCommitAnswers,
} from '../../../../test/utils/transaction-failure';

interface LedgerEntry {
  _id: string;
  runs: number;
}

const ENTRY_ID = 'entry';

describe('a commit whose answer was lost', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let events: Model<SecurityEventDocument>;
  let lost: LostCommitAnswers | undefined;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('commit_answer_lost'),
      new FrozenClock(TEST_NOW),
    );
    events = harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (harness) {
      await harness.app.close();
    }
    if (mongo) {
      await mongo.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await harness.sessions.deleteMany({});
    await harness.grants.deleteMany({});
    await harness.users.deleteMany({});
    await events.deleteMany({});
    await ledger().replaceOne(
      { _id: ENTRY_ID },
      { runs: 0 },
      { upsert: true, writeConcern: { w: 'majority' } },
    );
  });

  afterEach(() => {
    lost?.restore();
    lost = undefined;
  });

  function ledger() {
    return harness.connection.collection<LedgerEntry>('commit_ledger');
  }

  /** Real transactional work whose every run leaves a mark in the database. */
  async function runCountedWork(): Promise<{
    outcome: string;
    workRuns: number;
  }> {
    let workRuns = 0;
    const outcome = await withMajorityTransaction(
      harness.connection,
      async (session: ClientSession) => {
        workRuns += 1;
        await ledger().updateOne(
          { _id: ENTRY_ID },
          { $inc: { runs: 1 } },
          { session },
        );
        return 'committed';
      },
    ).catch((error: unknown) =>
      error instanceof Error ? error.name : 'unknown rejection',
    );
    return { outcome, workRuns };
  }

  async function storedRuns(): Promise<number | undefined> {
    return (await ledger().findOne({ _id: ENTRY_ID }))?.runs;
  }

  it('asks for the commit again, not the work, when the commit had landed', async () => {
    lost = loseCommitAnswers(harness.connection, { lands: true, times: 1 });

    const result = await runCountedWork();

    expect({
      ...result,
      commitAttempts: lost.commitAttempts(),
      storedRuns: await storedRuns(),
    }).toEqual({
      outcome: 'committed',
      workRuns: 1,
      commitAttempts: 2,
      storedRuns: 1,
    });
  });

  it('lands the work once when the first commit never reached the database', async () => {
    lost = loseCommitAnswers(harness.connection, { lands: false, times: 1 });

    const result = await runCountedWork();

    expect({
      ...result,
      commitAttempts: lost.commitAttempts(),
      storedRuns: await storedRuns(),
    }).toEqual({
      outcome: 'committed',
      workRuns: 1,
      commitAttempts: 2,
      storedRuns: 1,
    });
  });

  it('reports an unknown outcome instead of rerunning when every answer is lost', async () => {
    lost = loseCommitAnswers(harness.connection, { lands: true, times: 3 });

    const result = await runCountedWork();

    expect({
      ...result,
      commitAttempts: lost.commitAttempts(),
      storedRuns: await storedRuns(),
    }).toEqual({
      outcome: 'UnknownTransactionOutcomeError',
      workRuns: 1,
      commitAttempts: 3,
      storedRuns: 1,
    });
  });

  it('stores one session, not one per attempt, when a sign-in loses every answer', async () => {
    const user = await createTestUser(
      harness.users,
      'lost-answer@example.test',
    );
    lost = loseCommitAnswers(harness.connection, { lands: true, times: 3 });

    await expect(
      harness.sessionService.createSession(
        user._id,
        'Mozilla/5.0',
        '127.0.0.1',
        WEB_CLIENT_ID,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
    });

    expect({
      sessions: await harness.sessions.countDocuments({ user: user._id }),
      issuedEvents: await events.countDocuments({
        action: SECURITY_EVENT_ACTION.SESSION_ISSUED,
      }),
      issuanceFence: (await harness.users.findById(user._id))?.issuanceFence,
    }).toEqual({ sessions: 1, issuedEvents: 1, issuanceFence: 1 });
  });

  it('signs the user in once when a single answer is lost', async () => {
    const user = await createTestUser(
      harness.users,
      'one-lost-answer@example.test',
    );
    lost = loseCommitAnswers(harness.connection, { lands: true, times: 1 });

    const issued = await harness.sessionService.createSession(
      user._id,
      'Mozilla/5.0',
      '127.0.0.1',
      WEB_CLIENT_ID,
    );
    lost.restore();

    expect({
      validated:
        (await harness.sessionService.validateSession(issued.sessionToken)) !==
        null,
      sessions: await harness.sessions.countDocuments({ user: user._id }),
      issuedEvents: await events.countDocuments({
        action: SECURITY_EVENT_ACTION.SESSION_ISSUED,
      }),
    }).toEqual({ validated: true, sessions: 1, issuedEvents: 1 });
  });
});
