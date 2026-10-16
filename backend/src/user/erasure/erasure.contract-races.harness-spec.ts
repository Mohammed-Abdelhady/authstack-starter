import { RaceGate } from '../../../test/utils/race-gate';
import { holdReruns } from '../../../test/utils/session/issuance-contract/issuance-contract-support';
import { ERASURE_STANDING } from './constants/erasure.constants';
import type { ErasureHarness } from './erasure.contract.harness-spec';
import type { ErasureLease } from './types/erasure';

/**
 * A restore and step 1 of an erasure on one account at the same time, each
 * in its own transaction on its own connection: exactly one of them goes on.
 */
export function describeErasureRaceContract(
  get: () => ErasureHarness,
  past: Date,
  leaseUntil: Date,
): void {
  const lease = (): ErasureLease => ({
    owner: 'worker-a',
    now: get().clock.now(),
    until: leaseUntil,
  });

  it('refuses a restore that meets step 1 holding the account, once step 1 commits', async () => {
    const h = get();
    const user = await h.seedAccount('race-step@example.test', true, past);
    const held = new RaceGate();
    const reruns = holdReruns();
    const step1 = h.runner.run(async (u) => {
      const begun = await h.jobs.beginIn(u, user.id, lease());
      await held.hold();
      return begun;
    });
    await held.reached(1);
    const restore = h
      .runnerWith(reruns.pause)
      .run((u) => h.jobs.holdForRestoreIn(u, user.id));
    const both = Promise.allSettled([step1, restore]);
    try {
      // Refused while step 1 holds the account, or through it if nothing locks.
      await Promise.race([
        restore.catch(() => undefined),
        reruns.refused.reached(1),
      ]);
      held.release();
      // Step 1 commits before the refused restore may run again.
      await step1.catch(() => undefined);
    } finally {
      held.release();
      reruns.refused.release();
    }

    const [begun, restored] = await both;
    expect({
      begun: begun.status === 'fulfilled' ? begun.value?.job.step : 'failed',
      restored: restored.status === 'fulfilled' ? restored.value : 'failed',
      schedule: await h.schedule(user.id),
    }).toEqual({
      begun: 'erasing',
      restored: ERASURE_STANDING.ERASING,
      schedule: past,
    });
  });

  it('passes over an account a restore holds, which is then no longer due', async () => {
    const h = get();
    const user = await h.seedAccount('race-restore@example.test', true, past);
    const held = new RaceGate();
    const reruns = holdReruns();
    const restore = h.runner.run(async (u) => {
      const standing = await h.jobs.holdForRestoreIn(u, user.id);
      await held.hold();
      return standing;
    });
    await held.reached(1);
    const step1 = h
      .runnerWith(reruns.pause)
      .run((u) => h.jobs.beginIn(u, user.id, lease()));
    const both = Promise.allSettled([restore, step1]);
    try {
      // Step 1 skipped the row, or was refused while the restore holds it.
      await Promise.race([
        step1.catch(() => undefined),
        reruns.refused.reached(1),
      ]);
      held.release();
      // The restore commits before a refused step 1 may run again.
      await restore.catch(() => undefined);
    } finally {
      held.release();
      reruns.refused.release();
    }

    const [restored, begun] = await both;
    expect({
      restored: restored.status === 'fulfilled' ? restored.value : 'failed',
      begun: begun.status === 'fulfilled' ? begun.value : 'failed',
      schedule: await h.schedule(user.id),
      due: await h.jobs.findDue(h.clock.now(), 10),
    }).toEqual({
      restored: ERASURE_STANDING.RESTORABLE,
      begun: null,
      schedule: null,
      due: [],
    });
  });
}
