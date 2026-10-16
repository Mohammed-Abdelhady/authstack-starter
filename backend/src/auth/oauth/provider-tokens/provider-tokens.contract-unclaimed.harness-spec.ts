import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import type { ProviderTokensHarness } from './provider-tokens.contract.harness-spec';
import type { SealedToken, TokenToKeep } from './types/provider-tokens';

const DAY_MS = 86_400_000;
export const IDENTITY = { provider: 'apple', subject: 'mine' };
export const SEALED: SealedToken = {
  ciphertext: 'ciphertext',
  iv: 'iv',
  tag: 'tag',
  keyId: 'key-id',
};

/** A token kept now, whose link check falls due a day later. */
export function token(clientId: string, subject = 'mine'): TokenToKeep {
  return {
    provider: 'apple',
    subject,
    clientId,
    sealed: SEALED,
    storedAt: TEST_NOW,
    checkAfter: new Date(TEST_NOW.getTime() + DAY_MS),
  };
}

/** Kept tokens that no account linked by their check: both databases alike. */
export function describeUnclaimedTokens(
  get: () => ProviderTokensHarness,
): void {
  function take(limit = 10) {
    const harness = get();
    return harness.unitOfWork.run((work) =>
      harness.store.takeUnclaimedIn(work, harness.clock.now(), limit),
    );
  }

  it('takes a token no account links once its check is due, and clears a linked one', async () => {
    const harness = get();
    await harness.store.keep(token('web', 'refused'));
    await harness.store.keep(token('web', 'linked'));
    await harness.link('linked');
    harness.clock.advance(DAY_MS - 1);
    const early = await take();
    harness.clock.advance(1);
    const due = await take();
    const again = await take();

    expect(early).toEqual({ checked: 0, unclaimed: [] });
    expect(due).toEqual({
      checked: 2,
      unclaimed: [
        {
          provider: 'apple',
          subject: 'refused',
          clientId: 'web',
          sealed: SEALED,
          storedAt: TEST_NOW,
        },
      ],
    });
    expect(again).toEqual({ checked: 0, unclaimed: [] });
    expect((await harness.tokenRows()).map(({ subject }) => subject)).toEqual([
      'linked',
    ]);
  });

  it('checks the oldest due check first, at most the limit', async () => {
    const harness = get();
    await harness.store.keep({
      ...token('web', 'second'),
      checkAfter: new Date(TEST_NOW.getTime() + DAY_MS + 1),
    });
    await harness.store.keep(token('web', 'first'));
    harness.clock.advance(DAY_MS + 1);

    const taken = await take(1);

    expect(taken.unclaimed.map(({ subject }) => subject)).toEqual(['first']);
  });

  it('moves the check when the same identity keeps a newer token', async () => {
    const harness = get();
    await harness.store.keep(token('web', 'returning'));
    await harness.store.keep({
      ...token('web', 'returning'),
      checkAfter: new Date(TEST_NOW.getTime() + 2 * DAY_MS),
    });
    harness.clock.advance(DAY_MS);

    expect(await take()).toEqual({ checked: 0, unclaimed: [] });
  });
}
