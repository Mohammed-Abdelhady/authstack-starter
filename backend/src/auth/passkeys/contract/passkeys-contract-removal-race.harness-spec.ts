import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import { holdReruns } from '../../../../test/utils/session/issuance-contract/issuance-contract-support';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  CREDENTIAL_ID,
  FeatureSwitches, // feature:email-password,magic-link
  NOW,
  OTHER_CREDENTIAL_ID,
  PasskeysHarnessSource,
  passkeyServices,
} from './passkeys-contract.harness-spec';

const LAST_WAY_IN = { code: 'PASSKEY_LAST_SIGN_IN_METHOD', status: 409 };
const NOT_FOUND = { code: 'PASSKEY_NOT_FOUND', status: 404 }; // feature:email-password,magic-link

function outcomeOf(result: PromiseSettledResult<unknown>): unknown {
  if (result.status === 'fulfilled') return 'removed';
  const reason: unknown = result.reason;
  return reason instanceof AppException
    ? { code: reason.code, status: reason.getStatus() }
    : reason;
}

/** An account whose only ways in are two passkeys: either may go, never both. */
async function seedTwoPasskeys(
  harness: PasskeysHarnessSource,
): Promise<{ userId: string; firstId: string; secondId: string }> {
  const userId = await harness().seedAccount({ email: 'two@example.test' });
  const firstId = await harness().seedPasskey({
    userId,
    credentialId: CREDENTIAL_ID,
    createdAt: NOW,
  });
  const secondId = await harness().seedPasskey({
    userId,
    credentialId: OTHER_CREDENTIAL_ID,
    createdAt: NOW,
  });
  return { userId, firstId, secondId };
}

/** Two removals on one account at the same time. */
export function removalRaceCases(harness: PasskeysHarnessSource): void {
  it('keeps one passkey when the last two are removed at the same time', async () => {
    const { userId, firstId, secondId } = await seedTwoPasskeys(harness);
    const reruns = holdReruns();
    const { management } = passkeyServices(
      harness(),
      { password: false },
      reruns.pause,
    );
    const atRemoval = new RaceGate();
    const restore = holdBefore(harness().passkeys, 'remove', () => atRemoval);
    const first = management.remove(userId, firstId);
    const second = management.remove(userId, secondId);
    const both = Promise.allSettled([first, second]);
    try {
      // Both counted two passkeys and are about to remove theirs, or one
      // was refused while the other holds them.
      await Promise.race([atRemoval.reached(2), reruns.refused.reached(1)]);
      atRemoval.release();
      // One of them finishes before the refused one may run again.
      await Promise.race([first, second]).catch(() => undefined);
    } finally {
      atRemoval.release();
      reruns.refused.release();
      restore();
    }

    const outcomes = (await both).map(outcomeOf);
    expect(outcomes).toContain('removed');
    expect(outcomes).toContainEqual(LAST_WAY_IN);
    expect(await harness().storedPasskeys()).toHaveLength(1);
  });

  it('counts again when the other passkey went after the count', async () => {
    const { userId, firstId, secondId } = await seedTwoPasskeys(harness);
    const reruns = holdReruns();
    const { management } = passkeyServices(
      harness(),
      { password: false },
      reruns.pause,
    );
    const counted = new RaceGate();
    const restore = holdBefore(harness().passkeys, 'remove', (call) =>
      call === 0 ? counted : undefined,
    );
    // The first removal has counted two passkeys and not removed its own.
    const first = management.remove(userId, firstId);
    await counted.reached(1);
    const second = management.remove(userId, secondId);
    const both = Promise.allSettled([first, second]);
    try {
      // The second one removed its passkey, or was refused because the
      // first holds them.
      await Promise.race([
        second.catch(() => undefined),
        reruns.refused.reached(1),
      ]);
      counted.release();
      await Promise.race([first, second]).catch(() => undefined);
    } finally {
      counted.release();
      reruns.refused.release();
      restore();
    }

    const outcomes = (await both).map(outcomeOf);
    expect(outcomes).toContain('removed');
    expect(outcomes).toContainEqual(LAST_WAY_IN);
    expect(await harness().storedPasskeys()).toHaveLength(1);
  });

  // feature:email-password:start
  it('answers the second of two removals of one passkey as not found, when the password is what stays', async () => {
    expect(await removeTwiceAtOnce(harness, {})).toEqual([
      NOT_FOUND,
      'removed',
    ]);
    expect(await harness().storedPasskeys()).toEqual([]);
  });

  // feature:email-password:end

  // feature:magic-link:start
  it('answers the second of two removals of one passkey as not found, when two other ways in stay', async () => {
    expect(await removeTwiceAtOnce(harness, { magicLink: true })).toEqual([
      NOT_FOUND,
      'removed',
    ]);
    expect(await harness().storedPasskeys()).toEqual([]);
  });
  // feature:magic-link:end
}

// feature:email-password,magic-link:start
/**
 * Two removals of the one passkey of an account with a password, both past
 * the read that found it. Answers how each ended, refusals first.
 */
async function removeTwiceAtOnce(
  harness: PasskeysHarnessSource,
  features: FeatureSwitches,
): Promise<unknown[]> {
  const userId = await harness().seedAccount({
    email: 'repeat@example.test',
    passwordHash: 'a-stored-password-hash',
  });
  const passkeyId = await harness().seedPasskey({
    userId,
    credentialId: CREDENTIAL_ID,
    createdAt: NOW,
  });
  const reruns = holdReruns();
  const { management } = passkeyServices(harness(), features, reruns.pause);
  const atRemoval = new RaceGate();
  const restore = holdBefore(harness().passkeys, 'remove', () => atRemoval);
  const first = management.remove(userId, passkeyId);
  const second = management.remove(userId, passkeyId);
  const both = Promise.allSettled([first, second]);
  try {
    // One is about to remove the passkey. The other is there too, or waits
    // for the hold, or was refused it.
    await atRemoval.reached(1);
    atRemoval.release();
    await Promise.race([first, second]).catch(() => undefined);
  } finally {
    atRemoval.release();
    reruns.refused.release();
    restore();
  }

  return (await both)
    .map(outcomeOf)
    .sort((left) => (left === 'removed' ? 1 : -1));
}
// feature:email-password,magic-link:end
