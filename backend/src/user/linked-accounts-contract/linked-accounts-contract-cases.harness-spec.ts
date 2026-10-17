import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import { holdBefore, RaceGate } from '../../../test/utils/race-gate';
import { rejectionOf } from '../../../test/utils/session/issuance-contract/issuance-contract-support';
import {
  answerOf,
  refusalOf,
} from '../../../test/utils/user/accounts-contract/accounts-contract-support';
import {
  LinkedFixture,
  LinkedHarnessSource,
  linkedServicesOn,
  profileOf,
} from './linked-accounts-contract.harness-spec';

const LINKED_ELSEWHERE = {
  code: 'OAUTH_ACCOUNT_LINKED_ELSEWHERE',
  status: 409,
};
const IDENTITY_RULE = 'user.linked_account';

/** Linking, unlinking and choosing the provider a profile follows. */
export function linkedAccountCases(
  harness: LinkedHarnessSource,
  fixture: () => LinkedFixture,
): void {
  it('links a provider account and makes the first one primary', async () => {
    const { ownerId } = fixture();
    const { linking } = linkedServicesOn(harness());

    const linked = await linking.linkProvider(
      ownerId,
      'google',
      profileOf('google-1'),
    );
    await linking.linkProvider(ownerId, 'github', profileOf('github-1'));

    expect(linked.id).toBe(ownerId);
    expect(linked.primaryProvider).toBe('google');
    expect(
      linked.linkedAccounts.map(({ provider, providerId }) => ({
        provider,
        providerId,
      })),
    ).toEqual([{ provider: 'google', providerId: 'google-1' }]);
    expect(await harness().storedLinks(ownerId)).toEqual([
      { provider: 'google', providerId: 'google-1' },
      { provider: 'github', providerId: 'github-1' },
    ]);
    expect((await harness().syncFacts(ownerId))?.primaryProvider).toBe(
      'google',
    );
    expect(await linking.getLinkedProviders(ownerId)).toEqual([
      'email',
      'google',
      'github',
    ]);
  });

  it('refuses a provider twice and a profile with another address', async () => {
    const { ownerId } = fixture();
    const { linking } = linkedServicesOn(harness());
    await linking.linkProvider(ownerId, 'google', profileOf('google-1'));

    expect(
      await refusalOf(
        linking.linkProvider(ownerId, 'google', profileOf('google-2')),
      ),
    ).toEqual({ code: 'PROVIDER_ALREADY_LINKED', status: 409 });
    expect(
      await refusalOf(
        linking.linkProvider(
          ownerId,
          'github',
          profileOf('github-1', { email: 'someone-else@example.test' }),
        ),
      ),
    ).toEqual({ code: 'EMAIL_MISMATCH_ON_LINK', status: 409 });
    expect(await harness().storedLinks(ownerId)).toEqual([
      { provider: 'google', providerId: 'google-1' },
    ]);
  });

  it('gives one provider identity to one account only', async () => {
    const { ownerId, otherId } = fixture();
    const { linking } = linkedServicesOn(harness());
    await linking.linkProvider(ownerId, 'google', profileOf('shared-identity'));

    const refused = await refusalOf(
      linking.linkProvider(
        otherId,
        'google',
        profileOf('shared-identity', { email: 'other@example.test' }),
      ),
    );

    expect(refused).toEqual(LINKED_ELSEWHERE);
    // The refused account keeps neither the link nor the primary provider.
    expect(await harness().storedLinks(otherId)).toEqual([]);
    expect((await harness().syncFacts(otherId))?.primaryProvider).toBeNull();
    expect(await linking.getLinkedProviders(otherId)).toEqual(['email']);
  });

  it('names the identity rule when the store refuses a link', async () => {
    const { ownerId, otherId } = fixture();
    const stores = harness();
    const owner = await stores.links.findAccount(ownerId);
    const other = await stores.links.findAccount(otherId);
    if (!owner || !other) throw new Error('the accounts are not stored');
    await stores.links.addLink(owner, {
      provider: 'google',
      providerId: 'shared-identity',
    });

    const refused = await rejectionOf(
      stores.links.addLink(other, {
        provider: 'google',
        providerId: 'shared-identity',
        primaryProvider: 'google',
      }),
    );

    expect(refused).toBeInstanceOf(UniqueConflictError);
    expect(refused).toMatchObject({ constraint: IDENTITY_RULE });
    // The same provider id under another provider is another identity.
    await stores.links.addLink(other, {
      provider: 'github',
      providerId: 'shared-identity',
    });
    expect(await stores.storedLinks(otherId)).toEqual([
      { provider: 'github', providerId: 'shared-identity' },
    ]);
  });

  it('lets one of two accounts take an identity they link at once', async () => {
    const { ownerId, otherId } = fixture();
    const { linking } = linkedServicesOn(harness());
    const atLink = new RaceGate();
    const restore = holdBefore(harness().links, 'addLink', () => atLink);
    const racers = Promise.allSettled([
      linking.linkProvider(ownerId, 'google', profileOf('contested')),
      linking.linkProvider(
        otherId,
        'google',
        profileOf('contested', { email: 'other@example.test' }),
      ),
    ]);
    try {
      // Both passed every check and neither has written.
      await atLink.reached(2);
    } finally {
      atLink.release();
      restore();
    }

    const outcomes = (await racers).map((result) =>
      result.status === 'fulfilled' ? 'linked' : answerOf(result.reason),
    );
    expect(outcomes).toContain('linked');
    expect(outcomes).toContainEqual(LINKED_ELSEWHERE);
    const holders = [
      ...(await harness().storedLinks(ownerId)),
      ...(await harness().storedLinks(otherId)),
    ];
    expect(holders).toEqual([{ provider: 'google', providerId: 'contested' }]);
  });

  it('unlinks a provider and moves the primary to one that remains', async () => {
    const { ownerId } = fixture();
    const { linking } = linkedServicesOn(harness());
    await linking.linkProvider(ownerId, 'google', profileOf('google-1'));
    await linking.linkProvider(ownerId, 'github', profileOf('github-1'));

    const unlinked = await linking.unlinkProvider(ownerId, 'google');

    expect(unlinked.primaryProvider).toBe('github');
    expect(await harness().storedLinks(ownerId)).toEqual([
      { provider: 'github', providerId: 'github-1' },
    ]);
    expect((await harness().syncFacts(ownerId))?.primaryProvider).toBe(
      'github',
    );

    // feature:email-password,magic-link:start
    // With no provider left there is no primary provider either.
    await linking.unlinkProvider(ownerId, 'github');
    expect(await harness().storedLinks(ownerId)).toEqual([]);
    expect((await harness().syncFacts(ownerId))?.primaryProvider).toBeNull();
    expect(await linking.getLinkedProviders(ownerId)).toEqual(['email']);
    // feature:email-password,magic-link:end
  });

  it('refuses to unlink email, an unknown provider, or anything of a deactivated account', async () => {
    const { ownerId } = fixture();
    const { linking } = linkedServicesOn(harness());
    await linking.linkProvider(ownerId, 'google', profileOf('google-1'));

    expect(await refusalOf(linking.unlinkProvider(ownerId, 'email'))).toEqual({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(await refusalOf(linking.unlinkProvider(ownerId, 'github'))).toEqual({
      code: 'PROVIDER_NOT_LINKED',
      status: 400,
    });
    expect(await linking.canUnlinkProvider(ownerId, 'google')).toBe(true); // feature:email-password,magic-link
    expect(await linking.canUnlinkProvider(ownerId, 'email')).toBe(false);
    expect(
      await linking.canUnlinkProvider(harness().absentId(), 'google'),
    ).toBe(false);

    await harness().alterAccount(ownerId, { deleted: true });
    expect(await refusalOf(linking.unlinkProvider(ownerId, 'google'))).toEqual({
      code: 'USER_NOT_FOUND',
      status: 404,
    });
    expect(await refusalOf(linking.getLinkedProviders(ownerId))).toEqual({
      code: 'USER_NOT_FOUND',
      status: 404,
    });
    expect(await linking.isPrimaryProvider(ownerId, 'google')).toBe(false);
    // This one read never asks for the deactivation, so it still answers.
    expect(await linking.canUnlinkProvider(ownerId, 'google')).toBe(true); // feature:email-password,magic-link
    expect(await harness().storedLinks(ownerId)).toEqual([
      { provider: 'google', providerId: 'google-1' },
    ]);
  });
}
