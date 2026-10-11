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
  refresh,
  signInNative,
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

/** A replay of a spent token against a rotation of its successor, both orders. */
export function replayRaceCases(harness: NativeHarnessSource): void {
  const { gate, restoreLater, heldReruns, refusedOr } = nativeRaceTools();

  const secondStands = (h: NativeContractHarness): string =>
    h.takenAt === TAKEN_AT.FIRST_READ ? REFUSED : REACHED_ITS_WRITE;

  async function count(action: string): Promise<number> {
    return (await actions(harness())).filter((name) => name === action).length;
  }

  /** A replay of the spent token and a rotation of its successor, both held. */
  async function holdReplayAndRotation() {
    const signedIn = await signInNative(harness());
    const successor = granted(
      await refresh(harness().services(), signedIn.tokens.refreshToken),
    );
    const rotationGate = gate();
    const replayGate = gate();
    const reruns = heldReruns();
    const services = harness().services({ pause: reruns.pause });
    restoreLater(
      holdBefore(services.rotation, 'claimAndRotate', (call) =>
        call === 0 ? rotationGate : undefined,
      ),
    );
    restoreLater(
      holdBefore(services.rotation, 'replay', (call) =>
        call === 0 ? replayGate : undefined,
      ),
    );

    const rotating = outcomeOf(
      refresh(services, successor.refreshToken).then(answerOf),
    );
    await rotationGate.reached(1);
    const replaying = outcomeOf(
      refresh(services, signedIn.tokens.refreshToken).then(answerOf),
    );
    const replayWas = await refusedOr(reruns.refused, replayGate);
    return {
      signedIn,
      rotating,
      replaying,
      replayWas,
      rotationGate,
      releaseReplay: () => {
        reruns.refused.release();
        replayGate.release();
      },
      reruns,
    };
  }

  it('has ended the family by the time a replay is answered as a failure, when the replay goes first', async () => {
    const race = await holdReplayAndRotation();
    race.releaseReplay();
    const replay = await race.replaying;
    const whenTheReplayWasAnswered = await familyState(
      harness(),
      race.signedIn.sessionId,
    );
    race.rotationGate.release();
    const rotation = await race.rotating;

    const observed = {
      replayWas: race.replayWas,
      replay,
      whenTheReplayWasAnswered,
      rotation,
      pauses: race.reruns.calls,
      family: await familyState(harness(), race.signedIn.sessionId),
      replays: await count(REPLAYED),
    };
    const ended = { ...ENDED, tokens: 4, unspent: 0, unrevoked: 0 };
    // An adapter that takes the family at its first read never lets the
    // replay in while the rotation holds it: the replay is refused, three
    // times, and answers that the authority is unavailable. The family is
    // alive then, and the rotation it could not overtake succeeds.
    expect(observed).toEqual(
      harness().takenAt === TAKEN_AT.FIRST_READ
        ? {
            replayWas: REFUSED,
            replay: ErrorCode.AUTHORITY_UNAVAILABLE,
            whenTheReplayWasAnswered: {
              ...ALIVE,
              tokens: 4,
              unspent: 2,
              unrevoked: 3,
            },
            rotation: 'ok',
            pauses: [1, 2],
            family: { ...ALIVE, tokens: 6, unspent: 2, unrevoked: 4 },
            replays: 0,
          }
        : {
            replayWas: REACHED_ITS_WRITE,
            replay: INVALID_GRANT,
            whenTheReplayWasAnswered: ended,
            rotation: INVALID_GRANT,
            pauses: [1],
            family: ended,
            replays: 1,
          },
    );
  });

  it('ends the family, the new pair included, when the rotation goes first and the replay follows', async () => {
    const race = await holdReplayAndRotation();
    race.rotationGate.release();
    const rotation = await race.rotating;
    race.releaseReplay();
    const replay = await race.replaying;

    expect({
      replayWas: race.replayWas,
      rotation,
      replay,
      pauses: race.reruns.calls,
      family: await familyState(harness(), race.signedIn.sessionId),
      replays: await count(REPLAYED),
    }).toEqual({
      replayWas: secondStands(harness()),
      rotation: 'ok',
      replay: INVALID_GRANT,
      pauses: [1],
      family: { ...ENDED, tokens: 6, unspent: 0, unrevoked: 0 },
      replays: 1,
    });
  });
}
