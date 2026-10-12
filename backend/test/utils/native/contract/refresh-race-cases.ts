import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore } from '../../race-gate';
import { NativeContractHarness, TAKEN_AT } from './native-contract-harness';
import {
  actions,
  answerOf,
  familyState,
  granted,
  NativeHarnessSource,
  outcomeOf,
  proofFor,
  refresh,
  signInNative,
  storedToken,
} from './native-contract-support';
import {
  nativeRaceTools,
  REACHED_ITS_WRITE,
  REFUSED,
} from './native-race-support';

const INVALID_GRANT = 'invalid_grant';
const REPLAYED = 'refresh_replayed';
const ALIVE = { sessionLive: true, revokedReason: null };
const ENDED = { sessionLive: false, revokedReason: REPLAYED };

/**
 * Two units of work on one token family. Where the second one stands when both
 * are held depends on where the adapter takes the family: at its first read it
 * is refused there, at its first write it gets as far as that write.
 */
export function refreshRaceCases(harness: NativeHarnessSource): void {
  const { gate, restoreLater, heldReruns, recordingPause, refusedOr } =
    nativeRaceTools();

  const secondStands = (h: NativeContractHarness): string =>
    h.takenAt === TAKEN_AT.FIRST_READ ? REFUSED : REACHED_ITS_WRITE;

  async function count(action: string): Promise<number> {
    return (await actions(harness())).filter((name) => name === action).length;
  }

  it('lets one of two refreshes of an unspent token rotate, stores its successor, and ends the family on the other', async () => {
    const signedIn = await signInNative(harness());
    const token = signedIn.tokens.refreshToken;
    const firstClaim = gate();
    const secondClaim = gate();
    const reruns = heldReruns();
    const services = harness().services({ pause: reruns.pause });
    restoreLater(
      holdBefore(services.rotation, 'claimAndRotate', (call) =>
        call === 0 ? firstClaim : secondClaim,
      ),
    );

    const first = refresh(services, token);
    await firstClaim.reached(1);
    const second = refresh(services, token);
    const secondWas = await refusedOr(reruns.refused, secondClaim);
    firstClaim.release();
    const winner = granted(await first);
    const successorWhileTheLoserIsHeld = await storedToken(
      harness(),
      signedIn.sessionId,
      winner.refreshToken,
    );
    reruns.refused.release();
    secondClaim.release();
    const loser = await second;

    expect({
      secondWas,
      successorWhileTheLoserIsHeld: {
        generation: successorWhileTheLoserIsHeld.generation,
        spent: successorWhileTheLoserIsHeld.spent,
        revokedAt: successorWhileTheLoserIsHeld.revokedAt,
      },
      loser: answerOf(loser),
      pauses: reruns.calls,
      family: await familyState(harness(), signedIn.sessionId),
      replays: await count(REPLAYED),
    }).toEqual({
      secondWas: secondStands(harness()),
      successorWhileTheLoserIsHeld: {
        generation: 2,
        spent: false,
        revokedAt: null,
      },
      loser: INVALID_GRANT,
      pauses: [1],
      family: { ...ENDED, tokens: 4, unspent: 0, unrevoked: 0 },
      replays: 1,
    });
  });

  it('answers both of two same-key refreshes of an unspent token, and keeps only the second pair', async () => {
    const signedIn = await signInNative(harness(), { boundBy: 'race-x' });
    const token = signedIn.tokens.refreshToken;
    const firstClaim = gate();
    const secondClaim = gate();
    const reruns = heldReruns();
    const services = harness().services({ pause: reruns.pause });
    restoreLater(
      holdBefore(services.rotation, 'claimAndRotate', (call) =>
        call === 0 ? firstClaim : secondClaim,
      ),
    );

    const first = refresh(services, token, proofFor('race-a', token));
    await firstClaim.reached(1);
    const second = refresh(services, token, proofFor('race-b', token));
    const secondWas = await refusedOr(reruns.refused, secondClaim);
    firstClaim.release();
    const winner = granted(await first);
    reruns.refused.release();
    secondClaim.release();
    const loser = granted(await second);

    const stored = async (refreshToken: string) => {
      const row = await storedToken(
        harness(),
        signedIn.sessionId,
        refreshToken,
      );
      return { spent: row.spent, ended: row.revokedAt !== null };
    };
    expect({
      secondWas,
      firstPair: await stored(winner.refreshToken),
      secondPair: await stored(loser.refreshToken),
      pauses: reruns.calls,
      family: await familyState(harness(), signedIn.sessionId),
      retries: await count('native_dpop_bound_retry'),
      replays: await count(REPLAYED),
    }).toEqual({
      secondWas: secondStands(harness()),
      firstPair: { spent: true, ended: true },
      secondPair: { spent: false, ended: false },
      pauses: [1],
      family: { ...ALIVE, tokens: 6, unspent: 2, unrevoked: 3 },
      retries: 1,
      replays: 0,
    });
  });

  it('admits one replacement in two retries of a spent bound token and answers the other as in progress', async () => {
    const signedIn = await signInNative(harness(), { boundBy: 'retry-x' });
    const token = signedIn.tokens.refreshToken;
    granted(
      await refresh(
        harness().services(),
        token,
        proofFor('retry-rotation', token),
      ),
    );
    const firstRetry = gate();
    const secondRetry = gate();
    const reruns = heldReruns();
    const services = harness().services({ pause: reruns.pause });
    restoreLater(
      holdBefore(services.retries, 'retryOrReplay', (call) =>
        call === 0 ? firstRetry : secondRetry,
      ),
    );

    const first = refresh(services, token, proofFor('retry-a', token));
    await firstRetry.reached(1);
    const second = refresh(services, token, proofFor('retry-b', token));
    const secondWas = await refusedOr(reruns.refused, secondRetry);
    firstRetry.release();
    const winner = await first;
    reruns.refused.release();
    secondRetry.release();
    const loser = await second;

    expect({
      secondWas,
      answers: [answerOf(winner), answerOf(loser)],
      pauses: reruns.calls,
      family: await familyState(harness(), signedIn.sessionId),
      retries: await count('native_dpop_bound_retry'),
      replays: await count(REPLAYED),
    }).toEqual({
      secondWas: secondStands(harness()),
      answers: ['ok', 'invalid_dpop_proof NATIVE_DPOP_RETRY_IN_PROGRESS'],
      pauses: [1],
      family: { ...ALIVE, tokens: 6, unspent: 2, unrevoked: 3 },
      retries: 1,
      replays: 0,
    });
  });

  it('refuses a second refresh whole, after three attempts, while a rotation holds the family', async () => {
    const signedIn = await signInNative(harness());
    const token = signedIn.tokens.refreshToken;
    const firstPair = gate();
    const attempts = recordingPause();
    restoreLater(
      holdBefore(
        harness().stores.credentials,
        'insertCredentialPair',
        (call) => (call === 0 ? firstPair : undefined),
      ),
    );

    const first = refresh(harness().services(), token);
    await firstPair.reached(1);
    const second = await outcomeOf(
      refresh(harness().services({ pause: attempts.pause }), token),
    );
    const whileTheFirstHolds = await familyState(harness(), signedIn.sessionId);
    firstPair.release();
    const winner = await first;

    expect({
      second,
      pauses: attempts.calls,
      whileTheFirstHolds,
      winner: answerOf(winner),
      family: await familyState(harness(), signedIn.sessionId),
      replays: await count(REPLAYED),
    }).toEqual({
      second: ErrorCode.AUTHORITY_UNAVAILABLE,
      pauses: [1, 2],
      whileTheFirstHolds: { ...ALIVE, tokens: 2, unspent: 2, unrevoked: 2 },
      winner: 'ok',
      family: { ...ALIVE, tokens: 4, unspent: 2, unrevoked: 3 },
      replays: 0,
    });
  });
}
