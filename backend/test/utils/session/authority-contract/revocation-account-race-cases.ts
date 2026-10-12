import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore } from '../../race-gate';
import { rerunAtOnce } from '../issuance-contract/issuance-contract-support';
import { ACCOUNT_TAKEN_AT } from './authority-contract-harness';
import {
  AuthorityHarnessSource,
  outcomeOf,
  sessionIdOf,
  storedFor,
  validates,
} from './authority-contract-support';
import { raceTools, REFUSED } from './revocation-race-support';

const COMMITTED = 'committed';
const ISSUED = 'session_issued';
const REVOKED_ALL = 'sessions_revoked_all';
const REVOKED_OTHERS = 'sessions_revoked_others';

/** A sign-in against a bulk sign-out: both write the account's versions. */
export function accountRaceCases(harness: AuthorityHarnessSource): void {
  const {
    gate,
    restoreLater,
    heldReruns,
    recordingPause,
    holdRevocationEvents,
    holdSignInBeforeItsInsert,
    startSignIn,
    account,
    refusedOr,
  } = raceTools(harness);

  it('refuses both bulk sign-outs whole, after three attempts, while a sign-in holds the account', async () => {
    const user = await account();
    const signInCounted = gate();
    holdSignInBeforeItsInsert(signInCounted);
    const signingIn = startSignIn(user.userId, rerunAtOnce);
    await signInCounted.reached(1);

    const others = recordingPause();
    const everywhereElse = await outcomeOf(
      harness()
        .revoker(others.pause)
        .revokeAllOthersExceptSession(user.userId, user.kept.sessionId),
    );
    const all = recordingPause();
    const everywhere = await outcomeOf(
      harness().revoker(all.pause).revokeAllForUser(user.userId),
    );
    const whileHeld = await storedFor(harness(), user.userId, [
      user.kept.sessionId,
      user.other.sessionId,
    ]);
    signInCounted.release();
    const issued = await signingIn;

    expect({
      everywhereElse,
      everywhere,
      pauses: [others.calls, all.calls],
      whileHeld,
      validates: [
        await validates(harness(), user.kept.token),
        await validates(harness(), user.other.token),
        await validates(harness(), issued.sessionToken),
      ],
      accountVersion: (await harness().issuance.account(user.userId))
        ?.sessionVersion,
    }).toEqual({
      everywhereElse: ErrorCode.AUTHORITY_UNAVAILABLE,
      everywhere: ErrorCode.AUTHORITY_UNAVAILABLE,
      pauses: [
        [1, 2],
        [1, 2],
      ],
      whileHeld: {
        accountVersion: 0,
        sessions: [
          { live: true, userVersion: 0 },
          { live: true, userVersion: 0 },
        ],
        events: [ISSUED, ISSUED],
      },
      validates: [true, true, true],
      accountVersion: 0,
    });
  });

  it('ends a sign-in that committed first, when the refused sign-out everywhere else runs again', async () => {
    const user = await account();
    const signInCounted = gate();
    holdSignInBeforeItsInsert(signInCounted);
    const signingIn = startSignIn(user.userId, rerunAtOnce);
    await signInCounted.reached(1);

    const reruns = heldReruns();
    const revocationWrote = gate();
    holdRevocationEvents(revocationWrote);
    const revoking = harness()
      .revoker(reruns.pause)
      .revokeAllOthersExceptSession(user.userId, user.kept.sessionId);
    const revocationWas = await refusedOr(reruns.refused, revocationWrote);
    signInCounted.release();
    const issued = await signingIn;
    revocationWrote.release();
    reruns.refused.release();
    const count = await revoking;

    expect({
      revocationWas,
      count,
      pauses: reruns.calls,
      validates: {
        kept: await validates(harness(), user.kept.token),
        other: await validates(harness(), user.other.token),
        signedInMeanwhile: await validates(harness(), issued.sessionToken),
      },
      accountVersion: (await harness().issuance.account(user.userId))
        ?.sessionVersion,
    }).toEqual({
      revocationWas: REFUSED,
      count: 2,
      pauses: [1],
      validates: { kept: true, other: false, signedInMeanwhile: false },
      accountVersion: 1,
    });
  });

  it('refuses a sign-in whole, after three attempts, while a sign-out everywhere else holds the account', async () => {
    const user = await account();
    const revocationWritten = gate();
    holdRevocationEvents(revocationWritten);
    const revoking = harness()
      .revoker(rerunAtOnce)
      .revokeAllOthersExceptSession(user.userId, user.kept.sessionId);
    await revocationWritten.reached(1);

    const attempts = recordingPause();
    const signInOutcome = await outcomeOf(
      startSignIn(user.userId, attempts.pause),
    );
    const whileHeld = {
      sessions: (await harness().issuance.sessions(user.userId)).length,
      account: await harness().issuance.account(user.userId),
      events: (await storedFor(harness(), user.userId, [user.kept.sessionId]))
        .events,
    };
    revocationWritten.release();
    const count = await revoking;

    expect({
      signInOutcome,
      pauses: attempts.calls,
      whileHeld,
      count,
      validates: {
        kept: await validates(harness(), user.kept.token),
        other: await validates(harness(), user.other.token),
      },
      after: await harness().issuance.account(user.userId),
    }).toEqual({
      signInOutcome: ErrorCode.AUTHORITY_UNAVAILABLE,
      pauses: [1, 2],
      whileHeld: {
        sessions: 2,
        account: { issuanceFence: 2, sessionVersion: 0 },
        events: [ISSUED, ISSUED],
      },
      count: 1,
      validates: { kept: true, other: false },
      after: { issuanceFence: 2, sessionVersion: 1 },
    });
  });

  it.each([
    {
      name: 'everywhere else',
      event: REVOKED_OTHERS,
      keptValidates: true,
      count: 1,
    },
    { name: 'everywhere', event: REVOKED_ALL, keptValidates: false, count: 2 },
  ])(
    'admits a refused sign-in at the new version once the sign-out $name has committed',
    async ({ event, keptValidates, count }) => {
      const user = await account();
      const revocationWritten = gate();
      holdRevocationEvents(revocationWritten);
      const revoker = harness().revoker(rerunAtOnce);
      const revoking =
        event === REVOKED_OTHERS
          ? revoker.revokeAllOthersExceptSession(
              user.userId,
              user.kept.sessionId,
            )
          : revoker.revokeAllForUser(user.userId);
      await revocationWritten.reached(1);

      const reruns = heldReruns();
      const signInWrote = gate();
      holdSignInBeforeItsInsert(signInWrote);
      const signingIn = startSignIn(user.userId, reruns.pause);
      const signInWas = await refusedOr(reruns.refused, signInWrote);
      revocationWritten.release();
      const revokedCount = await revoking;
      signInWrote.release();
      reruns.refused.release();
      const issued = await signingIn;
      const newSessionId = await sessionIdOf(
        harness(),
        user.userId,
        issued.sessionToken,
      );

      expect({
        signInWas,
        revokedCount,
        pauses: reruns.calls,
        validates: {
          kept: await validates(harness(), user.kept.token),
          other: await validates(harness(), user.other.token),
          signedIn: await validates(harness(), issued.sessionToken),
        },
        stored: await storedFor(harness(), user.userId, [newSessionId]),
      }).toEqual({
        signInWas: REFUSED,
        revokedCount: count,
        pauses: [1],
        validates: { kept: keptValidates, other: false, signedIn: true },
        stored: {
          accountVersion: 1,
          sessions: [{ live: true, userVersion: 1 }],
          events: [ISSUED, ISSUED, event, ISSUED],
        },
      });
    },
  );

  it('ends in one of the two serial orders when the sign-in has only read the account', async () => {
    const user = await account();
    const signInRead = gate();
    restoreLater(
      holdBefore(harness().issuance.applications, 'requireEnabled', (call) =>
        call === 0 ? signInRead : undefined,
      ),
    );
    const signInReruns = recordingPause();
    const signingIn = startSignIn(user.userId, signInReruns.pause);
    await signInRead.reached(1);

    const revokeReruns = heldReruns();
    const revoking = harness()
      .revoker(revokeReruns.pause)
      .revokeAllOthersExceptSession(user.userId, user.kept.sessionId);
    const revocationWas = await Promise.race([
      revoking.then(() => COMMITTED),
      revokeReruns.refused.reached(1).then(() => REFUSED),
    ]);
    signInRead.release();
    const issued = await signingIn;
    revokeReruns.refused.release();
    const count = await revoking;
    const newSessionId = await sessionIdOf(
      harness(),
      user.userId,
      issued.sessionToken,
    );

    const revocationFirst = {
      revocationWas: COMMITTED,
      count: 1,
      signInPauses: [1],
      revocationPauses: [],
      validates: { kept: true, other: false, signedIn: true },
      signedInAtVersion: 1,
      accountVersion: 1,
    };
    const signInFirst = {
      revocationWas: REFUSED,
      count: 2,
      signInPauses: [],
      revocationPauses: [1],
      validates: { kept: true, other: false, signedIn: false },
      signedInAtVersion: 0,
      accountVersion: 1,
    };
    expect({
      revocationWas,
      count,
      signInPauses: signInReruns.calls,
      revocationPauses: revokeReruns.calls,
      validates: {
        kept: await validates(harness(), user.kept.token),
        other: await validates(harness(), user.other.token),
        signedIn: await validates(harness(), issued.sessionToken),
      },
      signedInAtVersion: (await harness().session(newSessionId))?.userVersion,
      accountVersion: (await harness().issuance.account(user.userId))
        ?.sessionVersion,
    }).toEqual(
      harness().accountTakenAt === ACCOUNT_TAKEN_AT.FIRST_READ
        ? signInFirst
        : revocationFirst,
    );
  });
}
