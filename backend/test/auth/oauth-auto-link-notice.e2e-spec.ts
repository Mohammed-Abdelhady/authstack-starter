import request, { type Response } from 'supertest';
import { AccountLinkingService } from '../../src/user/services/account-linking.service';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { MailService } from '../../src/mail/mail.service';
import type { OAuthProviderStrategy } from '../../src/auth/oauth/oauth-provider.interface';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import type { ApiBody, UserResponse } from '../types/e2e-responses';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import { SEED_ADMIN } from '../constants/seed-users';
import { ACCOUNT_CREATION_METHOD } from '../../src/auth/constants/account-creation';
import { UnitOfWork } from '../../src/common/persistence/unit-of-work';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { ProviderSignInStore } from '../../src/auth/oauth/stores/provider-sign-in.store';
import { OAuthService } from '../../src/auth/oauth/oauth.service';
import { AccountCreationRefusedError } from '../../src/auth/services/registration/account-creation-refused.error';
import {
  installAccountCreationPolicy,
  type SwitchableAccountCreationPolicy,
} from '../utils/account-creation-policy';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface AdminAccount extends UserResponse {
  linkedProviders: string[];
}

interface LinkedProviders {
  providers: string[];
}

const AUTO_LINK_EMAIL = 'oauth-auto-link@example.test';
const PROVIDER_ACCOUNT = {
  providerId: 'provider-auto-link-user',
  email: AUTO_LINK_EMAIL,
  emailVerified: true,
  name: 'Linked Provider User',
};

const PROVIDER: OAuthProviderStrategy = {
  id: 'google',
  displayName: 'Google fixture',
  envPrefix: 'GOOGLE',
  supportsPkce: true,
  usesOidc: false,
  emailAlwaysVerified: true,
  autoLinksByEmail: true,
  callbackMethod: 'GET',
  isEnabled: () => true,
  getAuthorizationUrl: ({ state }) =>
    `https://provider.example/authorize?state=${encodeURIComponent(state)}`,
  exchangeCode: () => Promise.resolve({ accessToken: 'provider-token' }),
  fetchProfile: () => Promise.resolve(PROVIDER_ACCOUNT),
};

describe('OAuth first sign-in notices for automatic account linking (e2e)', () => {
  let e2e: E2eApp;
  let policy: SwitchableAccountCreationPolicy;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, { browserStrategy: PROVIDER });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await e2e.reset();
    policy = installAccountCreationPolicy(e2e.app);
  });

  afterEach(() => jest.restoreAllMocks());

  async function beginProviderSignIn(): Promise<{
    browser: ReturnType<typeof request.agent>;
    callback: Response;
  }> {
    const browser = request.agent(e2e.httpServer);
    const start = await browser
      .get('/api/auth/oauth/google/start')
      .redirects(0)
      .expect(302);
    const state = new URL(String(start.headers.location)).searchParams.get(
      'state',
    );
    if (!state) throw new Error('OAuth start returned no state');

    const callback = await browser
      .get('/api/auth/oauth/google/callback')
      .query({ state, code: 'provider-code' })
      .redirects(0)
      .expect(302);
    return { browser, callback };
  }

  function callbackAnswer(response: Response): {
    status: string | null;
    code: string | null;
  } {
    const redirect = new URL(String(response.headers.location));
    return {
      status: redirect.searchParams.get('status'),
      code: redirect.searchParams.get('code'),
    };
  }

  it('links the verified account before sending one notice to its verified address', async () => {
    policy.refused = true;
    const account = await e2e.state.accounts.createAccount({
      email: AUTO_LINK_EMAIL,
      name: 'Account Holder',
      role: UserRole.USER,
      isVerified: true,
    });
    const accountLinking = e2e.app.get(AccountLinkingService);
    const mailService = e2e.app.get(MailService);
    const sendMail = mailService.sendMail.bind(mailService);
    const providersWhenMailed: string[][] = [];
    const sendMailSpy = jest
      .spyOn(mailService, 'sendMail')
      .mockImplementation(async (message) => {
        providersWhenMailed.push(
          await accountLinking.getLinkedProviders(account._id),
        );
        await sendMail(message);
      });

    try {
      const { browser, callback } = await beginProviderSignIn();
      expect(callbackAnswer(callback)).toEqual({ status: 'ok', code: null });

      const profile = await browser.get('/api/user/profile').expect(200);
      const signedIn = (profile.body as ApiBody<UserResponse>).data;
      expect([signedIn.id, signedIn.email]).toEqual([
        account._id,
        AUTO_LINK_EMAIL,
      ]);

      const linked = await browser
        .get('/api/user/linked-providers')
        .expect(200);
      expect((linked.body as ApiBody<LinkedProviders>).data.providers).toEqual([
        'email',
        'google',
      ]);

      const mail = await e2e.captureMail();
      expect(mail).toHaveLength(1);
      expect(mail.map(({ to, subject }) => ({ to, subject }))).toEqual([
        {
          to: AUTO_LINK_EMAIL,
          subject: 'A sign-in provider was added',
        },
      ]);
      expect(providersWhenMailed).toEqual([['email', 'google']]);
      expect(policy.calls).toEqual([]);
    } finally {
      sendMailSpy.mockRestore();
    }
  });

  it('creates a provider account through one policy call in the browser transaction', async () => {
    const { callback } = await beginProviderSignIn();

    expect(callbackAnswer(callback)).toEqual({ status: 'ok', code: null });
    expect(policy.calls).toHaveLength(1);
    expect(policy.calls[0].request).toEqual({
      application: WEB_CLIENT_ID,
      method: ACCOUNT_CREATION_METHOD.PROVIDER,
    });
    expect(policy.calls[0].unitOfWork).toBeInstanceOf(UnitOfWork);
    const stored = await e2e.state.accounts.accountWithAddress(AUTO_LINK_EMAIL);
    expect(stored).toMatchObject({ email: AUTO_LINK_EMAIL, isVerified: true });
    expect(await e2e.state.auth.countAccountsWithAddress(AUTO_LINK_EMAIL)).toBe(
      1,
    );
    expect(
      await e2e.app.get(ProviderSignInStore).findByIdentity({
        provider: PROVIDER.id,
        providerId: PROVIDER_ACCOUNT.providerId,
      }),
    ).toMatchObject({ id: stored?._id });
  });

  it('refuses provider creation without storing an account, link, or session', async () => {
    policy.refused = true;

    const creating = e2e.app
      .get(OAuthService)
      .findOrCreateUser(PROVIDER, PROVIDER_ACCOUNT);

    await expect(creating).rejects.toBeInstanceOf(AccountCreationRefusedError);
    await expect(creating).rejects.toMatchObject({
      code: ErrorCode.ACCOUNT_CREATION_REFUSED,
    });
    expect(policy.calls).toHaveLength(1);
    expect(await e2e.state.accounts.accountIdFor(AUTO_LINK_EMAIL)).toBeNull();
    expect(
      await e2e.app.get(ProviderSignInStore).findByIdentity({
        provider: PROVIDER.id,
        providerId: PROVIDER_ACCOUNT.providerId,
      }),
    ).toBeNull();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('redirects a refused browser provider callback without storing an account, link or session', async () => {
    policy.refused = true;

    const { callback } = await beginProviderSignIn();

    expect(callback.status).toBe(302);
    expect(callbackAnswer(callback)).toEqual({
      status: 'error',
      code: ErrorCode.ACCOUNT_CREATION_REFUSED,
    });
    expect(policy.calls).toHaveLength(1);
    expect(policy.calls[0].request).toEqual({
      application: WEB_CLIENT_ID,
      method: ACCOUNT_CREATION_METHOD.PROVIDER,
    });
    expect(
      await e2e.state.accounts.accountWithAddress(AUTO_LINK_EMAIL),
    ).toBeNull();
    expect(await e2e.state.auth.countAccountsWithAddress(AUTO_LINK_EMAIL)).toBe(
      0,
    );
    expect(
      await e2e.app.get(ProviderSignInStore).findByIdentity({
        provider: 'google',
        providerId: 'provider-auto-link-user',
      }),
    ).toBeNull();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('signs an already linked provider account in without asking the refusing policy', async () => {
    const account = await e2e.state.accounts.createAccount({
      email: AUTO_LINK_EMAIL,
      name: 'Linked account',
      isVerified: true,
    });
    await e2e.app
      .get(AccountLinkingService)
      .linkProvider(account._id, PROVIDER.id, PROVIDER_ACCOUNT);
    policy.refused = true;

    const { browser, callback } = await beginProviderSignIn();

    expect(callbackAnswer(callback)).toEqual({ status: 'ok', code: null });
    const profile = await browser.get('/api/user/profile').expect(200);
    expect((profile.body as ApiBody<UserResponse>).data.id).toBe(account._id);
    expect(policy.calls).toEqual([]);
    expect(await e2e.state.auth.countAccountsWithAddress(AUTO_LINK_EMAIL)).toBe(
      1,
    );
  });

  it('refuses an unverified account match without linking it or sending a notice', async () => {
    const account = await e2e.state.accounts.createAccount({
      email: AUTO_LINK_EMAIL,
      name: 'Unverified Holder',
      role: UserRole.USER,
      isVerified: false,
    });
    const admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    const { callback } = await beginProviderSignIn();

    expect(callbackAnswer(callback)).toEqual({
      status: 'error',
      code: ErrorCode.OAUTH_ACCOUNT_EXISTS,
    });
    const stored = await admin
      .get(`/api/admin/users/${account._id}`)
      .expect(200);
    expect((stored.body as ApiBody<AdminAccount>).data.linkedProviders).toEqual(
      ['email'],
    );
    expect(await e2e.state.accounts.accountIdFor(AUTO_LINK_EMAIL)).toBe(
      account._id,
    );
    expect(await e2e.captureMail()).toEqual([]);
  });
});
