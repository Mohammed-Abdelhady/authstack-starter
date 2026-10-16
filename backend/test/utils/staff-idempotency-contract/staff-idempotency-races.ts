import { IDEMPOTENCY_CLAIM } from '../../../src/admin/constants/staff-operations';
import { RaceGate, holdBefore } from '../race-gate';
import { IdempotencyHarnessSource } from './staff-idempotency-harness';
import {
  claimInput,
  FIRST_HASH,
  RESOURCE_ID,
  SECOND_HASH,
} from './staff-idempotency-support';

export function staffIdempotencyRaces(current: IdempotencyHarnessSource): void {
  // Concurrent creates with one key must commit exactly one resource owner.
  it('allows exactly one concurrent claim and returns its committed resource', async () => {
    const h = current();
    const start = new RaceGate();
    const committed = new RaceGate();
    const restore = holdBefore(h.store, 'claim', (call) =>
      call < 2 ? start : undefined,
    );
    const runner = h.runner(() => committed.hold());
    const compete = async (requestHash: string) => {
      const input = claimInput(h, 'first-actor', requestHash);
      const result = await runner.run(async (uow) => {
        const claim = await h.store.claim(uow, input);
        if (claim.status === IDEMPOTENCY_CLAIM.CLAIMED) {
          await h.store.complete(uow, input.scope, RESOURCE_ID);
        }
        return claim;
      });
      if (result.status === IDEMPOTENCY_CLAIM.CLAIMED) committed.release();
      return { result, requestHash };
    };
    const first = compete(FIRST_HASH);
    const second = compete(SECOND_HASH);
    try {
      await Promise.race([
        start.reached(2),
        Promise.all([first, second]).then(() => {
          throw new Error('claimers completed before the start gate');
        }),
      ]);
      start.release();
      const results = await Promise.all([first, second]);
      expect(results.map(({ result }) => result.status).sort()).toEqual([
        IDEMPOTENCY_CLAIM.CLAIMED,
        IDEMPOTENCY_CLAIM.EXISTING,
      ]);
      const winner = results.find(
        ({ result }) => result.status === IDEMPOTENCY_CLAIM.CLAIMED,
      );
      if (!winner) throw new Error('no claim won');
      const loser = results.find(
        ({ result }) => result.status === IDEMPOTENCY_CLAIM.EXISTING,
      );
      expect(loser?.result).toEqual({
        status: IDEMPOTENCY_CLAIM.EXISTING,
        requestHash: winner.requestHash,
        resourceId: RESOURCE_ID,
      });
      expect(await h.records()).toEqual([
        { requestHash: winner.requestHash, resourceId: RESOURCE_ID },
      ]);
    } finally {
      start.release();
      committed.release();
      restore();
      await Promise.allSettled([first, second]);
    }
  });
}
