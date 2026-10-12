import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { TEST_NOW } from '../../frozen-clock';
import {
  rejectionOf,
  rerunAtOnce,
} from '../issuance-contract/issuance-contract-support';
import {
  AuthorityHarnessSource,
  signIn,
  storedFor,
  validates,
} from './authority-contract-support';

const ISSUED = 'session_issued';

/** The revocation store by itself, and inside a unit of work a caller owns. */
export function revocationStoreCases(harness: AuthorityHarnessSource): void {
  function revoker() {
    return harness().revoker(rerunAtOnce);
  }

  it("commits with the caller's unit of work, and stores nothing when the caller fails after it", async () => {
    const committed = await harness().issuance.seedAccount();
    const failed = await harness().issuance.seedAccount();
    const committedSession = await signIn(harness(), committed);
    const failedKept = await signIn(harness(), failed, 'kept/1');
    const failedOther = await signIn(harness(), failed, 'other/1');
    const runner = harness().issuance.runner(rerunAtOnce);
    const count = await runner.run((unitOfWork) =>
      revoker().revokeAllForUserIn(unitOfWork, committed),
    );
    const callerFailed = new Error('the caller failed after the revocation');
    const everywhere = await rejectionOf(
      runner.run(async (unitOfWork) => {
        await revoker().revokeAllForUserIn(unitOfWork, failed);
        throw callerFailed;
      }),
    );
    const everywhereElse = await rejectionOf(
      runner.run(async (unitOfWork) => {
        await revoker().revokeAllOthersExceptSessionIn(
          unitOfWork,
          failed,
          failedKept.sessionId,
        );
        throw callerFailed;
      }),
    );
    expect({
      count,
      committedValidates: await validates(harness(), committedSession.token),
      rethrown: [everywhere === callerFailed, everywhereElse === callerFailed],
      failed: await storedFor(harness(), failed, [
        failedKept.sessionId,
        failedOther.sessionId,
      ]),
      failedOtherValidates: await validates(harness(), failedOther.token),
    }).toEqual({
      count: 1,
      committedValidates: false,
      rethrown: [true, true],
      failed: {
        accountVersion: 0,
        sessions: [
          { live: true, userVersion: 0 },
          { live: true, userVersion: 0 },
        ],
        events: [ISSUED, ISSUED],
      },
      failedOtherValidates: true,
    });
  });

  it('answers each guarded write with what it did, not with a count', async () => {
    const userId = await harness().issuance.seedAccount();
    const kept = await signIn(harness(), userId, 'kept/1');
    const ended = await signIn(harness(), userId, 'ended/1');
    const store = harness().revocationStore;
    const mark = { at: TEST_NOW, reason: 'current_logout' };
    const outcomes = await harness()
      .issuance.runner(rerunAtOnce)
      .run(async (unitOfWork) => ({
        revoke: await store.revokeSession(unitOfWork, ended.sessionId, mark),
        revokeAgain: await store.revokeSession(
          unitOfWork,
          ended.sessionId,
          mark,
        ),
        revokeAbsent: await store.revokeSession(
          unitOfWork,
          harness().absentSessionId(),
          mark,
        ),
        advance: await store.advanceAccountVersionFrom(unitOfWork, userId, 0),
        advanceStale: await store.advanceAccountVersionFrom(
          unitOfWork,
          userId,
          0,
        ),
        promote: await store.promoteSurvivor(unitOfWork, kept.sessionId, {
          from: 0,
          to: 1,
        }),
        promoteStale: await store.promoteSurvivor(unitOfWork, kept.sessionId, {
          from: 0,
          to: 1,
        }),
        promoteRevoked: await store.promoteSurvivor(
          unitOfWork,
          ended.sessionId,
          { from: 0, to: 1 },
        ),
        liveNow: await store.countLiveSessions(unitOfWork, {
          userId,
          userVersion: 1,
          now: TEST_NOW,
        }),
      }));
    expect(outcomes).toEqual({
      revoke: 'revoked',
      revokeAgain: 'not_live',
      revokeAbsent: 'not_live',
      advance: 'advanced',
      advanceStale: 'version_moved',
      promote: 'promoted',
      promoteStale: 'not_live',
      promoteRevoked: 'not_live',
      liveNow: 1,
    });
  });

  it('refuses an id this database could not have issued, in every method that takes one', async () => {
    const userId = await harness().issuance.seedAccount();
    const { sessionId } = await signIn(harness(), userId);
    const store = harness().revocationStore;
    const foreign = harness().foreignSessionId();
    const mark = { at: TEST_NOW, reason: 'current_logout' };
    const calls: Record<string, (unit: UnitOfWork) => Promise<unknown>> = {
      readAccountForRevocation: (unit) =>
        store.readAccountForRevocation(unit, foreign),
      countLiveSessions: (unit) =>
        store.countLiveSessions(unit, {
          userId: foreign,
          userVersion: 0,
          now: TEST_NOW,
        }),
      advanceAccountVersion: (unit) =>
        store.advanceAccountVersion(unit, foreign),
      advanceAccountVersionFrom: (unit) =>
        store.advanceAccountVersionFrom(unit, foreign, 0),
      findLiveSessionOfAccount: (unit) =>
        store.findLiveSessionOfAccount(unit, foreign, userId),
      findLiveSessionOfForeignAccount: (unit) =>
        store.findLiveSessionOfAccount(unit, sessionId, foreign),
      findSessionOfAccount: (unit) =>
        store.findSessionOfAccount(unit, foreign, userId),
      revokeSession: (unit) => store.revokeSession(unit, foreign, mark),
      promoteSurvivor: (unit) =>
        store.promoteSurvivor(unit, foreign, { from: 0, to: 1 }),
    };
    const malformed: Record<string, boolean> = {};
    for (const [name, call] of Object.entries(calls)) {
      const failure = await rejectionOf(
        harness().issuance.runner(rerunAtOnce).run(call),
      );
      malformed[name] = failure instanceof MalformedIdError;
    }
    expect(malformed).toEqual({
      readAccountForRevocation: true,
      countLiveSessions: true,
      advanceAccountVersion: true,
      advanceAccountVersionFrom: true,
      findLiveSessionOfAccount: true,
      findLiveSessionOfForeignAccount: true,
      findSessionOfAccount: true,
      revokeSession: true,
      promoteSurvivor: true,
    });
  });
}
