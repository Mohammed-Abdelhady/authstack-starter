import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  holdReruns,
  SIGN_IN_ADDRESS,
} from '../issuance-contract/issuance-contract-support';
import { AuthorityHarnessSource, signIn } from './authority-contract-support';

export const REFUSED = 'refused at once';
export const WROTE_UNDER_THE_FIRST = 'wrote while the first was open';

/**
 * What the race cases share. Each case holds the first unit of work open at a
 * store method, proves it stands there, starts the second, and waits for the
 * second to be refused (its rerun pause is a gate the case holds) or to get as
 * far as a write of its own. Nothing is released before both are where the
 * case says they are. Every gate and held method is put back after the case.
 */
export function raceTools(harness: AuthorityHarnessSource) {
  let gates: RaceGate[] = [];
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const gate of gates) gate.release();
    for (const restore of restores) restore();
    gates = [];
    restores = [];
  });

  function gate(): RaceGate {
    const created = new RaceGate();
    gates.push(created);
    return created;
  }

  return {
    gate,
    restoreLater: (restore: () => void): void => {
      restores.push(restore);
    },
    heldReruns: () => {
      const reruns = holdReruns();
      gates.push(reruns.refused);
      return reruns;
    },
    recordingPause: (): { pause: RerunPause; calls: number[] } => {
      const calls: number[] = [];
      return {
        calls,
        pause: (failedAttempts) => {
          calls.push(failedAttempts);
          return Promise.resolve();
        },
      };
    },
    /** Call 0 is the first revocation's event, written last in its work. */
    holdRevocationEvents: (first: RaceGate, later?: RaceGate): void => {
      restores.push(
        holdBefore(harness().revocationStore, 'appendSecurityEvent', (call) =>
          call === 0 ? first : later,
        ),
      );
    },
    /** The sign-in has counted the account's sessions and owns the account. */
    holdSignInBeforeItsInsert: (first: RaceGate, later?: RaceGate): void => {
      restores.push(
        holdBefore(harness().issuance.store, 'insertBrowserSession', (call) =>
          call === 0 ? first : later,
        ),
      );
    },
    startSignIn: (userId: string, pause: RerunPause, agent = 'new/1') => {
      return harness()
        .issuance.service(pause)
        .createBrowserSession(userId, agent, SIGN_IN_ADDRESS);
    },
    /** An account with two sessions, named for the part each plays. */
    account: async (agents: string[] = ['kept/1', 'other/1']) => {
      const userId = await harness().issuance.seedAccount();
      const kept = await signIn(harness(), userId, agents[0]);
      const other = await signIn(harness(), userId, agents[1]);
      return { userId, kept, other };
    },
    refusedOr: (refused: RaceGate, wrote: RaceGate): Promise<string> => {
      return Promise.race([
        refused.reached(1).then(() => REFUSED),
        wrote.reached(1).then(() => WROTE_UNDER_THE_FIRST),
      ]);
    },
  };
}
