import { ConfigService } from '@nestjs/config';
import { ProfileSyncService } from '../services/profile-sync.service';
import { refusalOf } from '../../../test/utils/user/accounts-contract/accounts-contract-support';
import {
  LinkedFixture,
  LinkedHarnessSource,
  linkedServicesOn,
  OWNER_EMAIL,
  profileOf,
} from './linked-accounts-contract.harness-spec';

/** The profile a provider feeds, and which accounts are due for it. */
export function profileSyncCases(
  harness: LinkedHarnessSource,
  fixture: () => LinkedFixture,
): void {
  it('copies name and picture from the primary provider only', async () => {
    const { ownerId } = fixture();
    const { linking, sync } = linkedServicesOn(harness());
    await linking.linkProvider(ownerId, 'google', profileOf('google-1'));
    await linking.linkProvider(ownerId, 'github', profileOf('github-1'));

    const skipped = await sync.syncProfileFromProvider(
      ownerId,
      'github',
      profileOf('github-1', { name: 'From GitHub' }),
    );
    expect(skipped.name).toBe('Owner');
    expect(await harness().syncFacts(ownerId)).toMatchObject({
      name: 'Owner',
      lastSyncedProvider: null,
      profileSyncedAt: null,
    });

    const pictureOnly = new ProfileSyncService(
      harness().links,
      new ConfigService({ profileSync: { fields: 'picture' } }),
    );
    const picture = await pictureOnly.syncProfileFromProvider(
      ownerId,
      'google',
      profileOf('google-1', {
        name: 'New Name',
        avatarUrl: 'https://cdn.example.com/new.png',
      }),
    );
    expect(picture).toMatchObject({
      name: 'Owner',
      avatarUrl: 'https://cdn.example.com/new.png',
    });
    expect(await harness().syncFacts(ownerId)).toMatchObject({
      name: 'Owner',
      avatarUrl: 'https://cdn.example.com/new.png',
    });

    const synced = await sync.syncProfileFromProvider(
      ownerId,
      'google',
      profileOf('google-1', {
        name: 'From Google',
        avatarUrl: 'https://cdn.example.test/a.png',
        email: 'changed@example.test',
      }),
    );

    expect(synced).toMatchObject({
      id: ownerId,
      name: 'From Google',
      avatarUrl: 'https://cdn.example.test/a.png',
      lastSyncedProvider: 'google',
      email: OWNER_EMAIL,
    });
    const stored = await harness().syncFacts(ownerId);
    expect(stored).toMatchObject({
      name: 'From Google',
      avatarUrl: 'https://cdn.example.test/a.png',
      lastSyncedProvider: 'google',
    });
    expect(stored?.profileSyncedAt).toBeInstanceOf(Date);
    expect(await sync.getSyncStatus(ownerId)).toMatchObject({
      lastSyncedProvider: 'google',
      primaryProvider: 'google',
      canSync: true,
    });
    expect(await sync.initiateManualSync(ownerId)).toMatchObject({
      requiresOAuth: true,
      provider: 'google',
    });
  });

  it('writes nothing when the provider profile changed nothing', async () => {
    const { ownerId, otherId } = fixture();
    const { linking, sync } = linkedServicesOn(harness());
    await linking.linkProvider(ownerId, 'google', profileOf('google-1'));

    await sync.syncProfileFromProvider(
      ownerId,
      'google',
      profileOf('google-1', { name: 'Owner' }),
    );

    expect(await harness().syncFacts(ownerId)).toMatchObject({
      lastSyncedProvider: null,
      profileSyncedAt: null,
    });
    expect(await refusalOf(sync.initiateManualSync(otherId))).toEqual({
      code: 'PROVIDER_NOT_LINKED',
      status: 400,
    });
    expect(await refusalOf(sync.getSyncStatus(harness().absentId()))).toEqual({
      code: 'USER_NOT_FOUND',
      status: 404,
    });
  });

  it('counts accounts with a provider profile that are due for a sync', async () => {
    const { ownerId, otherId } = fixture();
    const stores = harness();
    const { linking } = linkedServicesOn(stores);
    await linking.linkProvider(ownerId, 'google', profileOf('google-1'));
    await linking.linkProvider(
      otherId,
      'github',
      profileOf('github-1', { email: 'other@example.test' }),
    );
    const cutoff = new Date('2099-01-01T00:00:00.000Z');
    const due = (limit = 100): Promise<number> =>
      stores.links.countDueForSync(cutoff, 'email', limit);

    // Neither was ever synced.
    expect(await due()).toBe(2);
    expect(await due(1)).toBe(1);

    await stores.markSynced(ownerId, new Date('2099-01-01T00:00:00.000Z'));
    await stores.markSynced(otherId, new Date('2098-12-31T23:59:59.999Z'));
    // Synced exactly at the cutoff is not due. One millisecond earlier is.
    expect(await due()).toBe(1);
  });
}
