// feature:passkeys:start
// feature:email-password,magic-link,oauth-core:start
import { ConfigService } from '@nestjs/config';
import request from 'supertest'; // feature:email-password,magic-link
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  expectNoAuthority,
  reply, // feature:email-password,magic-link
} from '../utils/auth/audience-refusal.fixtures';
import {
  requireWebPasskey,
  storeExistingPasskey,
  webPost, // feature:email-password,magic-link
  webProviderCallback, // feature:oauth-core
} from '../utils/auth/required-passkey.fixture';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids'; // feature:email-password
import { storeBrowserPolicy } from '../utils/session/store-browser-policy'; // feature:email-password
// feature:totp:start
// feature:email-password:start
import { oweSecondFactor } from '../utils/auth/required-passkey.fixture';
// feature:email-password:end
// feature:totp:end
// feature:magic-link:start
import { MagicLinkStore } from '../../src/auth/magic-link/stores/magic-link.store';
import { hashMagicLinkToken } from '../../src/auth/magic-link/utils/magic-link-token.util';
// feature:magic-link:end
// feature:oauth-core:start
import { UserProfileService } from '../../src/user/services/user-profile.service';
import { LinkedAccountStore } from '../../src/user/stores/linked-account.store';
import {
  AudienceProvider,
  BAD_PROVIDER_CODE,
  providerReply,
} from '../utils/auth/audience-provider.fixture';
// feature:oauth-core:end

const LOGIN = '/api/auth/login'; // feature:email-password
const ACTIVATE = '/api/auth/activate'; // feature:email-password
const NEW_EMAIL = 'required-passkey-activation@example.test'; // feature:email-password
// feature:magic-link:start
const LINK_REQUEST = '/api/auth/magic-link/request';
const LINK_VERIFY = '/api/auth/magic-link/verify';
const BAD_LINK_TOKEN = 'invalid-link-token';
// feature:magic-link:end

// Failure: another credential issues a session where a verified passkey is required.
describe('required web passkey credential refusals', () => {
  let e2e: E2eApp;
  // feature:totp:start
  let restoreSecondFactor: (() => void) | undefined;
  // feature:totp:end
  const provider = new AudienceProvider(); // feature:oauth-core

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      browserStrategy: provider, // feature:oauth-core
      magicLinkEnabled: true, // feature:magic-link
      beforeStart: (app) => {
        const config = app.get(ConfigService);
        config.set('passkeys.enabled', true);
      },
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    // feature:totp:start
    const config = e2e.app.get(ConfigService);
    const enabled = config.get<boolean>('twoFactor.enabled');
    const encryptionKey = config.get<string>('twoFactor.encryptionKey');
    restoreSecondFactor = () => {
      config.set('twoFactor.enabled', enabled);
      config.set('twoFactor.encryptionKey', encryptionKey);
    };
    // feature:totp:end
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    await requireWebPasskey(e2e);
  });

  // feature:totp:start
  afterEach(() => {
    restoreSecondFactor?.();
    restoreSecondFactor = undefined;
  });
  // feature:totp:end

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  // feature:email-password:start
  // Failure: a correct password opens a session or second-factor challenge.
  it.each([false, true])(
    'refuses password before second factor, stored passkey %s',
    async (hasPasskey) => {
      if (hasPasskey) await storeExistingPasskey(e2e);
      await oweSecondFactor(e2e); // feature:totp
      const wrong = await webPost(e2e, LOGIN, {
        ...SEED_USER,
        password: 'WrongPassword1!',
      });
      const refused = await webPost(e2e, LOGIN, SEED_USER);
      expect(reply(refused)).toEqual(reply(wrong));
      expect(wrong.status).toBe(401);
      expect(wrong.body).toMatchObject({
        error: { code: ErrorCode.INVALID_CREDENTIALS },
      });
      expectNoAuthority(e2e, refused);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expect(await e2e.captureMail()).toEqual([]);
      // feature:totp:start
      expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(0);
      // feature:totp:end
    },
  );

  // Failure: activation stores an account that a required passkey never lets in,
  // and tells the caller the code was wrong.
  it('refuses a code issued before the requirement like a wrong code and stores nothing', async () => {
    await storeBrowserPolicy(e2e, WEB_CLIENT_ID, { requirePasskey: false });
    const browser = request.agent(e2e.httpServer);
    const requested = await webPost(
      e2e,
      '/api/auth/register',
      { email: NEW_EMAIL },
      browser,
    );
    expect(requested.status).toBe(200);
    const code = await e2e.mailedCode();
    const before = await e2e.state.auth.pendingRegistrationFor(NEW_EMAIL);
    await requireWebPasskey(e2e);
    const body = {
      email: NEW_EMAIL,
      password: 'ActivatedPassword1!',
      name: 'Required Passkey Account',
    };
    const wrong = await webPost(
      e2e,
      ACTIVATE,
      {
        ...body,
        email: SEED_USER.email,
        code: code === '000000' ? '000001' : '000000',
      },
      browser,
    );
    const refused = await webPost(e2e, ACTIVATE, { ...body, code }, browser);
    expect(reply(refused)).toEqual(reply(wrong));
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({
      error: { code: ErrorCode.ACTIVATION_CODE_INVALID },
    });
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect(await e2e.state.auth.countAccountsWithAddress(NEW_EMAIL)).toBe(0);
    expect(await e2e.state.auth.pendingRegistrationFor(NEW_EMAIL)).toEqual(
      before,
    );
  });
  // feature:email-password:end

  // feature:magic-link:start
  // Failure: a valid link signs in or is spent before passkey policy refuses it.
  it.each([false, true])(
    'preserves a refused magic link, stored passkey %s',
    async (hasPasskey) => {
      if (hasPasskey) await storeExistingPasskey(e2e);
      const browser = request.agent(e2e.httpServer);
      const requested = await webPost(
        e2e,
        LINK_REQUEST,
        { email: SEED_USER.email },
        browser,
      );
      expect(requested.status).toBe(200);
      const mail = await e2e.captureMail();
      const link = mail.at(-1)?.text?.match(/https?:\/\/[^\s]+/u)?.[0];
      const token = link ? new URL(link).searchParams.get('token') : null;
      if (!token) throw new Error('Magic-link request sent no token');
      const links = e2e.app.get(MagicLinkStore);
      const hash = hashMagicLinkToken(token);
      const before = await links.findUnspentLink(hash);
      expect(before?.email).toBe(SEED_USER.email);
      const wrong = await webPost(
        e2e,
        LINK_VERIFY,
        { token: BAD_LINK_TOKEN, confirm: true },
        browser,
      );
      const refused = await webPost(
        e2e,
        LINK_VERIFY,
        { token, confirm: true },
        browser,
      );
      expect(reply(refused)).toEqual(reply(wrong));
      expect(wrong.status).toBe(400);
      expect(wrong.body).toMatchObject({
        error: { code: ErrorCode.MAGIC_LINK_INVALID },
      });
      expectNoAuthority(e2e, refused);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expect(await links.findUnspentLink(hash)).toEqual(before);
      expect((await e2e.captureMail()).length).toBe(mail.length);
    },
  );
  // feature:magic-link:end

  // feature:oauth-core:start
  // Failure: a provider links or synchronizes an account before passkey refusal.
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'refuses provider without side effects, stored passkey %s and linked %s',
    async (hasPasskey, linked) => {
      if (hasPasskey) await storeExistingPasskey(e2e);
      if (linked) {
        await e2e.state.auth.makeProviderCreated(SEED_USER.email, provider.id, [
          {
            provider: provider.id,
            providerId: `provider:${SEED_USER.email}`,
            linkedAt: TEST_NOW,
          },
        ]);
      }
      const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
      if (!userId) throw new Error('Seed account is missing');
      if (linked) {
        const links = e2e.app.get(LinkedAccountStore);
        const account = await links.findAccount(userId);
        if (!account) throw new Error('Linked account is missing');
        await links.savePrimaryProvider(account, provider.id);
      }
      const profiles = e2e.app.get(UserProfileService);
      const before = await profiles.getProfile(userId);
      const wrong = await webProviderCallback(e2e, provider, BAD_PROVIDER_CODE);
      const refused = await webProviderCallback(e2e, provider);
      expect(providerReply(refused)).toEqual(providerReply(wrong));
      expect(wrong.status).toBe(302);
      expect(
        new URL(String(wrong.headers.location)).searchParams.get('code'),
      ).toBe(ErrorCode.OAUTH_AUTHENTICATION_FAILED);
      expectNoAuthority(e2e, refused);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expect(await profiles.getProfile(userId)).toEqual(before);
      expect(await e2e.captureMail()).toEqual([]);
    },
  );
  // feature:oauth-core:end
});
// feature:email-password,magic-link,oauth-core:end
// feature:passkeys:end
