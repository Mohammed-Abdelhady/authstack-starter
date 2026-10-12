import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  credential,
  CREDENTIAL_ID,
  NOW,
  outcomeOf,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  refusalOf,
  signInBrowser,
} from './passkeys-contract.harness-spec';

const VERIFICATION_FAILED = {
  code: 'PASSKEY_VERIFICATION_FAILED',
  status: 401,
};
/** A signature count is unsigned and 32 bits wide: past a signed integer. */
const HIGH_COUNTER = 4_000_000_000;
const LATER = new Date('2099-01-01T12:00:30.000Z');

/** The signature counter: it only moves forward, and one assertion moves it. */
export function counterCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  const assertOnce = async (
    stored: number,
    received: number,
  ): Promise<{ outcome: string; counter: number; lastUsedAt: Date | null }> => {
    await harness().reset();
    const userId = await harness().seedAccount({ email: `c${stored}@x.test` });
    await harness().seedPasskey({
      userId,
      credentialId: CREDENTIAL_ID,
      counter: stored,
      createdAt: NOW,
    });
    const services = passkeyServices(harness());
    const holder = await signInBrowser(services);
    services.authenticator.assertion = {
      newCounter: received,
      userVerified: true,
    };
    const outcome = await outcomeOf(
      services.login.verify(
        { response: credential() },
        holder.request,
        holder.response,
      ),
    );
    const [passkey] = await harness().storedPasskeys();
    return {
      outcome,
      counter: passkey.counter,
      lastUsedAt: passkey.lastUsedAt,
    };
  };

  it('moves a counter forward and refuses one that repeats or goes back', async () => {
    expect(await assertOnce(7, 8)).toEqual({
      outcome: 'accepted',
      counter: 8,
      lastUsedAt: NOW,
    });
    expect(await assertOnce(7, 7)).toEqual({
      outcome: 'PASSKEY_VERIFICATION_FAILED',
      counter: 7,
      lastUsedAt: null,
    });
    expect(await assertOnce(9, 3)).toEqual({
      outcome: 'PASSKEY_VERIFICATION_FAILED',
      counter: 9,
      lastUsedAt: null,
    });
    expect(await assertOnce(1, 0)).toEqual({
      outcome: 'PASSKEY_VERIFICATION_FAILED',
      counter: 1,
      lastUsedAt: null,
    });
  });

  it('lets an authenticator that never counts through, and one that starts to', async () => {
    expect(await assertOnce(0, 0)).toEqual({
      outcome: 'accepted',
      counter: 0,
      lastUsedAt: NOW,
    });
    expect(await assertOnce(0, 5)).toEqual({
      outcome: 'accepted',
      counter: 5,
      lastUsedAt: NOW,
    });
    expect(await assertOnce(HIGH_COUNTER, HIGH_COUNTER + 1)).toEqual({
      outcome: 'accepted',
      counter: HIGH_COUNTER + 1,
      lastUsedAt: NOW,
    });
  });

  it('advances the counter for one of two simultaneous assertions', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      counter: 4,
      createdAt: NOW,
    });
    // Two ceremonies, each with its own challenge, both read counter 4.
    const first = await signInBrowser(services);
    const second = await signInBrowser(services);
    services.authenticator.assertion = { newCounter: 5, userVerified: true };
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().passkeys,
      'advanceCounter',
      () => gate,
    );

    const attempts = [first, second].map((from) =>
      outcomeOf(
        services.login.verify(
          { response: credential() },
          from.request,
          from.response,
        ),
      ),
    );
    await gate.reached(2);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes.sort()).toEqual([
      'PASSKEY_VERIFICATION_FAILED',
      'accepted',
    ]);
    expect(services.signIn.issued).toEqual([ownerId]);
    expect(await harness().storedPasskeys()).toMatchObject([
      { counter: 5, lastUsedAt: NOW },
    ]);
  });

  it('refuses, at the store, a counter the passkey was not read with', async () => {
    const { ownerId } = fixture();
    const { passkeys } = harness();
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      counter: 4,
      createdAt: NOW,
    });
    const stale = await passkeys.findByCredentialId(CREDENTIAL_ID);
    if (!stale) throw new Error('the seeded passkey was not found');

    expect(
      await passkeys.advanceCounter(stale, { counter: 5, usedAt: NOW }),
    ).toBe('advanced');
    expect(
      await passkeys.advanceCounter(stale, { counter: 6, usedAt: LATER }),
    ).toBe('already_advanced');
    expect(await harness().storedPasskeys()).toMatchObject([
      { counter: 5, lastUsedAt: NOW },
    ]);

    const fresh = await passkeys.findByCredentialId(CREDENTIAL_ID);
    if (!fresh) throw new Error('the seeded passkey was not found');
    expect(fresh).toMatchObject({ counter: 5, lastUsedAt: NOW });
    await passkeys.markUsed(fresh, LATER);
    expect(await harness().storedPasskeys()).toMatchObject([
      { counter: 5, lastUsedAt: LATER },
    ]);
  });

  it('keeps the counter a refused assertion presented out of the store', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      counter: 7,
      createdAt: NOW,
    });
    const holder = await signInBrowser(services);
    services.authenticator.assertion = { newCounter: 7, userVerified: true };
    services.storeCalls.length = 0;

    expect(
      await refusalOf(
        services.assertion.verify(
          credential(),
          holder.request,
          holder.response,
        ),
      ),
    ).toEqual(VERIFICATION_FAILED);
    expect(services.storeCalls).toEqual([
      'challenges.consume',
      'passkeys.findByCredentialId',
    ]);
  });
}
