import { ConfigService } from '@nestjs/config';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
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
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const UNKNOWN_EMAIL = 'closed-provider-new@example.test';

// Failure: provider self-creation bypasses closed admin or confirms an excluded identity.
describe('closed admin provider entry', () => {
  let e2e: E2eApp;
  const provider = new AudienceProvider();
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      browserStrategy: provider,
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

  it('answers closed unknown sign-up like an invalid provider credential', async () => {
    const wrong = await providerCallback(
      e2e,
      provider,
      UNKNOWN_EMAIL,
      BAD_PROVIDER_CODE,
    );
    const refused = await providerCallback(e2e, provider, UNKNOWN_EMAIL);
    expect(providerReply(refused)).toEqual(providerReply(wrong));
    expect(
      new URL(String(wrong.headers.location)).searchParams.get('code'),
    ).toBe('OAUTH_AUTHENTICATION_FAILED');
    expect(wrong.status).toBe(302);
    expect(await e2e.captureMail()).toEqual([]);
    expect(await e2e.state.accounts.accountIdFor(UNKNOWN_EMAIL)).toBeNull();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expectNoAuthority(e2e, refused);
  });

  it('answers audience refusal like an invalid provider credential', async () => {
    const wrong = await providerCallback(
      e2e,
      provider,
      SEED_USER.email,
      BAD_PROVIDER_CODE,
    );
    const refused = await providerCallback(e2e, provider, SEED_USER.email);
    expect(providerReply(refused)).toEqual(providerReply(wrong));
    expect(
      new URL(String(wrong.headers.location)).searchParams.get('code'),
    ).toBe('OAUTH_AUTHENTICATION_FAILED');
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('continues signing an admitted existing provider account in', async () => {
    await e2e.state.auth.linkProviderAccounts(SEED_ADMIN.email, [
      {
        provider: provider.id,
        providerId: `provider:${SEED_ADMIN.email}`,
        linkedAt: e2e.clock.now(),
      },
    ]);
    const signedIn = await providerCallback(e2e, provider, SEED_ADMIN.email);
    expect(signedIn.status).toBe(302);
    expect(
      new URL(String(signedIn.headers.location)).searchParams.get('status'),
    ).toBe('ok');
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });
});
