import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { TEST_NOW } from '../../frozen-clock';
import { holdBefore } from '../../race-gate';
import { rerunAtOnce } from '../issuance-contract/issuance-contract-support';
import {
  AuthorityHarnessSource,
  outcomeOf,
  signIn,
  storedFor,
  validates,
} from './authority-contract-support';
import { raceTools, REFUSED } from './revocation-race-support';

const ISSUED = 'session_issued';
const REVOKED = 'session_revoked';
const REVOKED_OTHERS = 'sessions_revoked_others';

/** Two units of work that end, keep or extend the same session. */
export function sessionRaceCases(harness: AuthorityHarnessSource): void {
  const {
    gate,
    restoreLater,
    heldReruns,
    holdRevocationEvents,
    account,
    refusedOr,
  } = raceTools(harness);

  it('does not revive a session whose revocation commits while the extension holds its read', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    const sixMinutesIn = new Date('2099-01-01T12:06:00.000Z');
    harness().issuance.clock.set(sixMinutesIn);
    const extensionRead = gate();
    const revocationWritten = gate();
    restoreLater(
      holdBefore(harness().authorityApplications, 'findByClientId', (call) =>
        call === 0 ? extensionRead : undefined,
      ),
    );
    holdRevocationEvents(revocationWritten);

    const extending = harness().validator().validateByToken(token, true);
    await extensionRead.reached(1);
    const revoking = harness().revoker(rerunAtOnce).revokeByToken(token);
    await revocationWritten.reached(1);
    revocationWritten.release();
    const revoked = await revoking;
    const validationAfterRevocation = await harness()
      .validator()
      .validateByToken(token, true);
    extensionRead.release();
    const extension = await extending;

    const stored = await harness().session(sessionId);
    expect({
      revoked,
      validationAfterRevocation,
      extensionWrote: extension?.extended,
      stored,
      laterValidation: await validates(harness(), token),
    }).toEqual({
      revoked: true,
      validationAfterRevocation: null,
      extensionWrote: false,
      stored: {
        isValid: false,
        revokedAt: sixMinutesIn,
        revokedReason: 'current_logout',
        userVersion: 0,
        idleExpiresAt: new Date('2099-01-01T12:10:00.000Z'),
        lastActivityAt: TEST_NOW,
        lastUsedAt: TEST_NOW,
      },
      laterValidation: false,
    });
  });

  it('keeps exactly one session when two sign-outs everywhere else name different ones', async () => {
    const user = await account(['first-kept/1', 'second-kept/1']);
    const firstWritten = gate();
    const secondWrote = gate();
    holdRevocationEvents(firstWritten, secondWrote);
    const first = harness()
      .revoker(rerunAtOnce)
      .revokeAllOthersExceptSession(user.userId, user.kept.sessionId);
    await firstWritten.reached(1);

    const reruns = heldReruns();
    const second = outcomeOf(
      harness()
        .revoker(reruns.pause)
        .revokeAllOthersExceptSession(user.userId, user.other.sessionId),
    );
    const secondWas = await refusedOr(reruns.refused, secondWrote);
    firstWritten.release();
    const firstCount = await first;
    secondWrote.release();
    reruns.refused.release();

    expect({
      secondWas,
      firstCount,
      second: await second,
      validates: [
        await validates(harness(), user.kept.token),
        await validates(harness(), user.other.token),
      ],
      stored: await storedFor(harness(), user.userId, [
        user.kept.sessionId,
        user.other.sessionId,
      ]),
    }).toEqual({
      secondWas: REFUSED,
      firstCount: 1,
      second: ErrorCode.SESSION_INVALID,
      validates: [true, false],
      stored: {
        accountVersion: 1,
        sessions: [
          { live: true, userVersion: 1 },
          { live: true, userVersion: 0 },
        ],
        events: [ISSUED, ISSUED, REVOKED_OTHERS],
      },
    });
  });

  it.each([{ second: 'by its credential' }, { second: 'by its id' }])(
    'signs one session out once when a second sign-out, $second, reaches it too',
    async ({ second: how }) => {
      const user = await account();
      const firstWritten = gate();
      const secondWrote = gate();
      holdRevocationEvents(firstWritten, secondWrote);
      const first = harness()
        .revoker(rerunAtOnce)
        .revokeByToken(user.other.token);
      await firstWritten.reached(1);

      const reruns = heldReruns();
      const revoker = harness().revoker(reruns.pause);
      const second =
        how === 'by its id'
          ? revoker.revokeById(user.other.sessionId, user.userId)
          : revoker.revokeByToken(user.other.token);
      const secondWas = await refusedOr(reruns.refused, secondWrote);
      firstWritten.release();
      const firstAnswer = await first;
      secondWrote.release();
      reruns.refused.release();

      expect({
        secondWas,
        answers: [firstAnswer, await second],
        events: (
          await storedFor(harness(), user.userId, [user.other.sessionId])
        ).events,
        keptValidates: await validates(harness(), user.kept.token),
      }).toEqual({
        secondWas: REFUSED,
        answers: [true, false],
        events: [ISSUED, ISSUED, REVOKED],
        keptValidates: true,
      });
    },
  );

  it('refuses to sign out everywhere else around a kept session that is being signed out', async () => {
    const user = await account();
    const signOutWritten = gate();
    const othersWrote = gate();
    holdRevocationEvents(signOutWritten, othersWrote);
    const signingOut = harness()
      .revoker(rerunAtOnce)
      .revokeByToken(user.kept.token);
    await signOutWritten.reached(1);

    const reruns = heldReruns();
    const others = outcomeOf(
      harness()
        .revoker(reruns.pause)
        .revokeAllOthersExceptSession(user.userId, user.kept.sessionId),
    );
    const othersWas = await refusedOr(reruns.refused, othersWrote);
    signOutWritten.release();
    const signedOut = await signingOut;
    othersWrote.release();
    reruns.refused.release();

    expect({
      othersWas,
      signedOut,
      others: await others,
      validates: [
        await validates(harness(), user.kept.token),
        await validates(harness(), user.other.token),
      ],
      stored: await storedFor(harness(), user.userId, [
        user.kept.sessionId,
        user.other.sessionId,
      ]),
    }).toEqual({
      othersWas: REFUSED,
      signedOut: true,
      others: ErrorCode.SESSION_INVALID,
      validates: [false, true],
      stored: {
        accountVersion: 0,
        sessions: [
          { live: false, userVersion: 0 },
          { live: true, userVersion: 0 },
        ],
        events: [ISSUED, ISSUED, REVOKED],
      },
    });
  });
}
