import { holdBefore, RaceGate } from '../../../test/utils/race-gate';
import { holdReruns } from '../../../test/utils/session/issuance-contract/issuance-contract-support';
import { refusalOf } from '../../../test/utils/user/accounts-contract/accounts-contract-support';
import { AppException } from '../../common/exceptions/app.exception';
import {
  LinkedFixture,
  LinkedHarnessSource,
  linkedServicesOn,
  profileOf,
  SignInSwitchesOf,
} from './linked-accounts-contract.harness-spec';

const LAST_PROVIDER = { code: 'CANNOT_UNLINK_LAST_PROVIDER', status: 400 };

function outcomeOf(result: PromiseSettledResult<unknown>): unknown {
  if (result.status === 'fulfilled') return 'unlinked';
  const reason: unknown = result.reason;
  return reason instanceof AppException
    ? { code: reason.code, status: reason.getStatus() }
    : reason;
}

/**
 * An account a provider created: it does not sign in by email, so its
 * providers are its only ways in.
 */
async function seedProviderAccount(
  harness: LinkedHarnessSource,
  ownerId: string,
  providers: string[],
): Promise<void> {
  const { linking } = linkedServicesOn(harness());
  for (const provider of providers) {
    await linking.linkProvider(ownerId, provider, profileOf(`${provider}-1`));
  }
  await harness().setAuthProvider(ownerId, providers[0]);
}

/** The last provider of an account that has no other way in stays. */
export function lastWayInCases(
  harness: LinkedHarnessSource,
  fixture: () => LinkedFixture,
): void {
  it('unlinks one of two providers and refuses the last of an account a provider created', async () => {
    const { ownerId } = fixture();
    await seedProviderAccount(harness, ownerId, ['google', 'github']);
    const { linking } = linkedServicesOn(harness());

    expect(await linking.canUnlinkProvider(ownerId, 'github')).toBe(true);
    await linking.unlinkProvider(ownerId, 'github');
    expect(await harness().storedLinks(ownerId)).toEqual([
      { provider: 'google', providerId: 'google-1' },
    ]);

    expect(await linking.canUnlinkProvider(ownerId, 'google')).toBe(false);
    expect(await refusalOf(linking.unlinkProvider(ownerId, 'google'))).toEqual(
      LAST_PROVIDER,
    );
    expect(await harness().storedLinks(ownerId)).toEqual([
      { provider: 'google', providerId: 'google-1' },
    ]);
  });

  it('keeps one provider when the last two are unlinked at the same time', async () => {
    const { ownerId } = fixture();
    await seedProviderAccount(harness, ownerId, ['google', 'github']);
    const reruns = holdReruns();
    const { linking } = linkedServicesOn(harness(), reruns.pause);
    const atRemoval = new RaceGate();
    const restore = holdBefore(harness().links, 'removeLink', () => atRemoval);
    const first = linking.unlinkProvider(ownerId, 'google');
    const second = linking.unlinkProvider(ownerId, 'github');
    const both = Promise.allSettled([first, second]);
    try {
      // Both counted two providers and are about to remove theirs, or one
      // was refused while the other holds the account's ways in.
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
    expect(outcomes).toContain('unlinked');
    expect(outcomes).toContainEqual(LAST_PROVIDER);
    expect(await harness().storedLinks(ownerId)).toHaveLength(1);
  });

  it('counts again when the other provider went after the count', async () => {
    const { ownerId } = fixture();
    await seedProviderAccount(harness, ownerId, ['google', 'github']);
    const reruns = holdReruns();
    const { linking } = linkedServicesOn(harness(), reruns.pause);
    const counted = new RaceGate();
    const restore = holdBefore(harness().links, 'removeLink', (call) =>
      call === 0 ? counted : undefined,
    );
    // The first unlink has counted two providers and not removed its own.
    const first = linking.unlinkProvider(ownerId, 'google');
    await counted.reached(1);
    const second = linking.unlinkProvider(ownerId, 'github');
    const both = Promise.allSettled([first, second]);
    try {
      // The second one removed its provider, or was refused because the
      // first holds the account's ways in.
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
    expect(outcomes).toContain('unlinked');
    expect(outcomes).toContainEqual(LAST_PROVIDER);
    expect(await harness().storedLinks(ownerId)).toHaveLength(1);
  });

  it('unlinks the only provider of an email account only while its address can sign in or be recovered', async () => {
    const accounts: Record<
      string,
      { passwordHash?: string; switches: SignInSwitchesOf; unlinked: boolean }
    > = {
      'nothing by email': {
        switches: { password: false, magicLink: false },
        unlinked: false,
      },
      'a password that cannot be used': {
        passwordHash: 'stored-hash',
        switches: { password: false, magicLink: false },
        unlinked: false,
      },
      // feature:email-password:start
      'password reset by email': {
        switches: { password: true, magicLink: false },
        unlinked: true,
      },
      // feature:email-password:end
      // feature:magic-link:start
      'magic links': {
        switches: { password: false, magicLink: true },
        unlinked: true,
      },
      // feature:magic-link:end
      // feature:email-password:start
      'a password': {
        passwordHash: 'stored-hash',
        switches: { password: true, magicLink: false },
        unlinked: true,
      },
      // feature:email-password:end
    };

    const unlinked: Record<string, boolean> = {};
    for (const [name, account] of Object.entries(accounts)) {
      const userId = await harness().seedAccount({
        email: `${name.replaceAll(' ', '-')}@example.test`,
        role: 'user',
        passwordHash: account.passwordHash,
      });
      const { linking } = linkedServicesOn(
        harness(),
        undefined,
        account.switches,
      );
      await linking.linkProvider(
        userId,
        'google',
        profileOf(`google-${name}`, {
          email: `${name.replaceAll(' ', '-')}@example.test`,
        }),
      );

      const attempt = linking.unlinkProvider(userId, 'google');
      if (account.unlinked) {
        await attempt;
      } else {
        expect(await refusalOf(attempt)).toEqual(LAST_PROVIDER);
      }
      unlinked[name] = (await harness().storedLinks(userId)).length === 0;
    }

    expect(unlinked).toEqual({
      'nothing by email': false,
      'a password that cannot be used': false,
      'password reset by email': true, // feature:email-password
      'magic links': true, // feature:magic-link
      'a password': true, // feature:email-password
    });
  });
}
