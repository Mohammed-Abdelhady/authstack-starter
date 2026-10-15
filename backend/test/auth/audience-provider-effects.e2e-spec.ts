import { ConfigService } from '@nestjs/config';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { OAuthService } from '../../src/auth/oauth/oauth.service';
import { AudienceAdmissionRefused } from '../../src/session/utils/authority/audience-admission';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../src/host/types/host-role.type';
import { AudienceMappingStore } from '../../src/user/stores/audience-mapping.store';
import { LinkedAccountStore } from '../../src/user/stores/linked-account.store';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  STAFF_TARGET_ROLE,
  arrangeAudiences,
} from '../utils/audience-authorization.fixtures';
import {
  AudienceProvider,
  BAD_PROVIDER_CODE,
  providerCallback,
  providerReply,
} from '../utils/auth/audience-provider.fixture';
import { expectNoAuthority } from '../utils/auth/audience-refusal.fixtures';
import {
  createNativeApplication,
  NATIVE_CLIENT_ID,
} from '../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const EMAIL = 'provider-effects@example.test';

// Failure: an excluded provider login links identity, syncs profile or mails before refusing.
describe('provider admission precedes account side effects', () => {
  let e2e: E2eApp;
  const provider = new AudienceProvider();
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      browserStrategy: provider,
      nativeEnabled: true,
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    await arrangeAudiences(e2e);
  });
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function account(audience: RoleAudience, linked: boolean) {
    const created = await e2e.state.accounts.createAccount({
      email: EMAIL,
      name: 'Before Provider',
      role: audience === ROLE_AUDIENCE.STAFF ? STAFF_TARGET_ROLE : 'user',
      isVerified: true,
    });
    await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
      const store = e2e.app.get(AudienceMappingStore);
      const snapshot = await store.snapshot(work);
      const pending = snapshot.accounts.find(({ id }) => id === created._id);
      if (!pending) throw new Error('provider account fixture is missing');
      await store.mapAccount(work, pending, audience);
    });
    if (linked) {
      await e2e.state.auth.linkProviderAccounts(EMAIL, [
        {
          provider: provider.id,
          providerId: `provider:${EMAIL}`,
          linkedAt: e2e.clock.now(),
        },
      ]);
    }
    return created._id;
  }

  const stored = (id: string) =>
    e2e.app.get(LinkedAccountStore).findAccount(id);

  it.each([false, true])(
    'refuses excluded existing account without writes, linked %s',
    async (linked) => {
      const id = await account(ROLE_AUDIENCE.CUSTOMER, linked);
      const before = await stored(id);
      expect(before?.name).toBe('Before Provider');
      expect(before?.primaryProvider).toBeUndefined();
      const wrong = await providerCallback(
        e2e,
        provider,
        EMAIL,
        BAD_PROVIDER_CODE,
      );
      const refused = await providerCallback(e2e, provider, EMAIL);
      expect(providerReply(refused)).toEqual(providerReply(wrong));
      expect(await stored(id)).toEqual(before);
      expect(await e2e.captureMail()).toEqual([]);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expectNoAuthority(e2e, refused);
    },
  );

  it('keeps admitted linking and profile sync working', async () => {
    const id = await account(ROLE_AUDIENCE.STAFF, false);
    const accepted = await providerCallback(e2e, provider, EMAIL);
    expect(accepted.status).toBe(302);
    expect(
      new URL(String(accepted.headers.location)).searchParams.get('status'),
    ).toBe('ok');
    const after = await stored(id);
    expect(after).toMatchObject({
      name: 'Provider Account',
      avatarUrl: 'https://provider.example/new-avatar.png',
      primaryProvider: provider.id,
      lastSyncedProvider: provider.id,
      linkedAccounts: [
        expect.objectContaining({
          provider: provider.id,
          providerId: `provider:${EMAIL}`,
        }),
      ],
    });
    expect((await e2e.captureMail()).map(({ to }) => to)).toEqual([EMAIL]);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  // Failure: the native profile seam defaults admission to web instead of its explicit client.
  it('checks the explicit native application before linking an existing address', async () => {
    const id = await account(ROLE_AUDIENCE.CUSTOMER, false);
    await createNativeApplication(e2e);
    await e2e.state.applications.changeApplication(NATIVE_CLIENT_ID, {
      accountAudience: ROLE_AUDIENCE.STAFF,
    });
    const before = await stored(id);
    provider.email = EMAIL;
    await expect(
      e2e.app
        .get(OAuthService)
        .resolveVerifiedProfile(
          provider,
          await provider.fetchProfile(),
          'en',
          NATIVE_CLIENT_ID,
        ),
    ).rejects.toBeInstanceOf(AudienceAdmissionRefused);
    expect(await stored(id)).toEqual(before);
    expect(await e2e.captureMail()).toEqual([]);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });
});
