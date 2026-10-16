import { IDEMPOTENCY_CLAIM } from '../../../src/admin/constants/staff-operations';
import { IdempotencyHarnessSource } from './staff-idempotency-harness';
import {
  claimInput,
  FIRST_HASH,
  KEY_LIFETIME_MS,
  RESOURCE_ID,
  SECOND_HASH,
} from './staff-idempotency-support';

export function staffIdempotencyCases(current: IdempotencyHarnessSource): void {
  // A replay must return the committed create rather than authorize another one.
  it('returns the original hash and completed resource for a live key', async () => {
    const h = current();
    const input = claimInput(h);
    const first = await h.runner().run(async (uow) => {
      const result = await h.store.claim(uow, input);
      await h.store.complete(uow, input.scope, RESOURCE_ID);
      return result;
    });
    expect(first).toEqual({ status: IDEMPOTENCY_CLAIM.CLAIMED });
    const second = await h
      .runner()
      .run((uow) => h.store.claim(uow, { ...input, requestHash: SECOND_HASH }));
    expect(second).toEqual({
      status: IDEMPOTENCY_CLAIM.EXISTING,
      requestHash: FIRST_HASH,
      resourceId: RESOURCE_ID,
    });
    expect(await h.records()).toEqual([
      { requestHash: FIRST_HASH, resourceId: RESOURCE_ID },
    ]);
  });

  // A failed create must not reserve the key or expose an uncommitted resource.
  it('rolls the claimed and completed record back with the unit of work', async () => {
    const h = current();
    const input = claimInput(h);
    const failure = new Error('create failed');
    await expect(
      h.runner().run(async (uow) => {
        await h.store.claim(uow, input);
        await h.store.complete(uow, input.scope, RESOURCE_ID);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await h.records()).toEqual([]);
    expect(await h.runner().run((uow) => h.store.claim(uow, input))).toEqual({
      status: IDEMPOTENCY_CLAIM.CLAIMED,
    });
  });

  // Expiry must release the key and discard the previous create's resource.
  it('takes over a record exactly at its expiry', async () => {
    const h = current();
    const input = claimInput(h);
    await h.runner().run(async (uow) => {
      await h.store.claim(uow, input);
      await h.store.complete(uow, input.scope, RESOURCE_ID);
    });
    h.clock.advance(KEY_LIFETIME_MS);
    const next = claimInput(h, input.scope.actorId, SECOND_HASH);
    expect(await h.runner().run((uow) => h.store.claim(uow, next))).toEqual({
      status: IDEMPOTENCY_CLAIM.CLAIMED,
    });
    expect(await h.records()).toEqual([
      { requestHash: SECOND_HASH, resourceId: null },
    ]);
  });

  // Another actor's request must never inherit an existing create's outcome.
  it('claims the same key independently for another actor', async () => {
    const h = current();
    const first = claimInput(h);
    await h.runner().run(async (uow) => {
      await h.store.claim(uow, first);
      await h.store.complete(uow, first.scope, RESOURCE_ID);
    });
    const second = claimInput(h, 'second-actor', SECOND_HASH);
    expect(await h.runner().run((uow) => h.store.claim(uow, second))).toEqual({
      status: IDEMPOTENCY_CLAIM.CLAIMED,
    });
    expect(await h.records()).toEqual([
      { requestHash: FIRST_HASH, resourceId: RESOURCE_ID },
      { requestHash: SECOND_HASH, resourceId: null },
    ]);
  });
}
