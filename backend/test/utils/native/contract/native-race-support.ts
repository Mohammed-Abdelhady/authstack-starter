import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { RaceGate } from '../../race-gate';
import { holdReruns } from '../../session/issuance-contract/issuance-contract-support';

export const REFUSED = 'refused at once';
export const REACHED_ITS_WRITE = 'reached its own write';

/**
 * What the race cases share. Each case holds the first unit of work open at a
 * method of a service or a store, proves it stands there, starts the second,
 * and waits for the second to be refused (its rerun pause is a gate the case
 * holds) or to reach its own gate. Nothing is released before both are where
 * the case says they are. Every gate and held method is put back afterwards.
 */
export function nativeRaceTools() {
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
    refusedOr: (refused: RaceGate, reached: RaceGate): Promise<string> =>
      Promise.race([
        refused.reached(1).then(() => REFUSED),
        reached.reached(1).then(() => REACHED_ITS_WRITE),
      ]),
  };
}
