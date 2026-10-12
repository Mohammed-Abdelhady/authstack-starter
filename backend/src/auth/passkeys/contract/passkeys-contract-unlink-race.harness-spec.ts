import { holdBefore, RaceGate } from '../../../../test/utils/race-gate'; // feature:email-password
import {
  holdReruns, // feature:email-password
  rerunAtOnce,
} from '../../../../test/utils/session/issuance-contract/issuance-contract-support';
import { AppException } from '../../../common/exceptions/app.exception'; // feature:email-password
import { AccountLinkingService } from '../../../user/services/account-linking.service';
import {
  CREDENTIAL_ID,
  FeatureSwitches,
  NOW,
  PasskeysHarnessSource,
  PasskeyServices,
  passkeyServices,
  refusalOf,
} from './passkeys-contract.harness-spec';

const LAST_WAY_IN = { code: 'PASSKEY_LAST_SIGN_IN_METHOD', status: 409 }; // feature:email-password
const LAST_PROVIDER = { code: 'CANNOT_UNLINK_LAST_PROVIDER', status: 400 };
/** No address can sign in or be recovered by itself. */
const NO_EMAIL_WAY_IN: FeatureSwitches = { password: false, magicLink: false };

interface OneOfEach {
  userId: string;
  passkeyId: string;
}

/** An account made to sign in by email, with no password, one provider and one passkey. */
async function seedOneOfEach(
  harness: PasskeysHarnessSource,
): Promise<OneOfEach> {
  const userId = await harness().seedAccount({
    email: 'both@example.test',
    linked: true,
  });
  const passkeyId = await harness().seedPasskey({
    userId,
    credentialId: CREDENTIAL_ID,
    createdAt: NOW,
  });
  return { userId, passkeyId };
}

/** The unlink on the same rule and switches as the passkey services. */
function linkingOn(
  harness: PasskeysHarnessSource,
  services: PasskeyServices,
): AccountLinkingService {
  return new AccountLinkingService(
    harness().links,
    services.signInRule,
    harness().runner(rerunAtOnce),
  );
}

// feature:email-password:start
function outcomeOf(result: PromiseSettledResult<unknown>): unknown {
  if (result.status === 'fulfilled') return 'done';
  const reason: unknown = result.reason;
  return reason instanceof AppException
    ? { code: reason.code, status: reason.getStatus() }
    : reason;
}
// feature:email-password:end

/** A passkey removal and a provider unlink on one account at the same time. */
export function unlinkRaceCases(harness: PasskeysHarnessSource): void {
  // feature:email-password:start
  it('keeps the passkey when the provider it counted is unlinked at the same time', async () => {
    // Password sign-in is on, so the address can be recovered and the
    // provider may go. The passkey may go only while the provider stays:
    // no password is stored and magic links are off.
    const { userId, passkeyId } = await seedOneOfEach(harness);
    const reruns = holdReruns();
    const services = passkeyServices(harness(), {}, reruns.pause);
    const { management } = services;
    const linking = linkingOn(harness, services);
    const atUnlink = new RaceGate();
    const atRemoval = new RaceGate();
    const restoreUnlink = holdBefore(
      harness().links,
      'removeLink',
      () => atUnlink,
    );
    const restoreRemoval = holdBefore(
      harness().passkeys,
      'remove',
      () => atRemoval,
    );
    // The unlink has passed its own check and not removed the provider. One
    // that was refused instead ends the wait, and the outcomes below say so.
    const unlink = linking.unlinkProvider(userId, 'google');
    await Promise.race([atUnlink.reached(1), unlink.catch(() => undefined)]);
    const removal = management.remove(userId, passkeyId);
    const both = Promise.allSettled([unlink, removal]);
    try {
      // The removal counted the provider and is about to remove the passkey,
      // or was refused because the unlink holds the account's ways in.
      await Promise.race([atRemoval.reached(1), reruns.refused.reached(1)]);
      atUnlink.release();
      atRemoval.release();
      await unlink.catch(() => undefined);
    } finally {
      atUnlink.release();
      atRemoval.release();
      reruns.refused.release();
      restoreUnlink();
      restoreRemoval();
    }

    expect((await both).map(outcomeOf)).toEqual(['done', LAST_WAY_IN]);
    expect(await harness().storedProviders(userId)).toEqual([]);
    expect(await harness().storedPasskeys()).toHaveLength(1);
  });
  // feature:email-password:end

  it('refuses the provider after the passkey went when no address can sign in by itself', async () => {
    const { userId, passkeyId } = await seedOneOfEach(harness);
    const services = passkeyServices(harness(), NO_EMAIL_WAY_IN);
    const linking = linkingOn(harness, services);

    // The provider counts, so the passkey goes.
    await services.management.remove(userId, passkeyId);
    expect(await refusalOf(linking.unlinkProvider(userId, 'google'))).toEqual(
      LAST_PROVIDER,
    );

    expect(await harness().storedPasskeys()).toEqual([]);
    expect(await harness().storedProviders(userId)).toEqual(['google']);
  });

  it('refuses the provider first and then lets the passkey go when no address can sign in by itself', async () => {
    const { userId, passkeyId } = await seedOneOfEach(harness);
    const services = passkeyServices(harness(), NO_EMAIL_WAY_IN);
    const linking = linkingOn(harness, services);

    // An unlink does not count passkeys, so the provider is its last way in.
    expect(await refusalOf(linking.unlinkProvider(userId, 'google'))).toEqual(
      LAST_PROVIDER,
    );
    await services.management.remove(userId, passkeyId);

    expect(await harness().storedPasskeys()).toEqual([]);
    expect(await harness().storedProviders(userId)).toEqual(['google']);
  });

  it('tells the page what each removal answers when a passkey and a provider are all there is', async () => {
    const { userId, passkeyId } = await seedOneOfEach(harness);
    const services = passkeyServices(harness(), NO_EMAIL_WAY_IN);
    const linking = linkingOn(harness, services);

    // An unlink does not count the passkey. A passkey removal counts the provider.
    expect(
      await linking.unlinkHints(
        userId,
        await linking.getLinkedProviders(userId),
      ),
    ).toEqual({ email: 'not_removable', google: 'last_sign_in_method' });
    expect((await services.management.list(userId)).data.canRemove).toBe(true);

    expect(await refusalOf(linking.unlinkProvider(userId, 'google'))).toEqual(
      LAST_PROVIDER,
    );
    await services.management.remove(userId, passkeyId);
    expect(await harness().storedPasskeys()).toEqual([]);
    expect(await harness().storedProviders(userId)).toEqual(['google']);
  });
}
