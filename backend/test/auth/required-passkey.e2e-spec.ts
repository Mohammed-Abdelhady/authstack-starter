import { ConfigService } from '@nestjs/config';
import request from 'supertest';
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
  reply,
} from '../utils/auth/audience-refusal.fixtures';
import {
  oweSecondFactor,
  requireWebPasskey,
  storeExistingPasskey,
  webPost,
  webProviderCallback,
} from '../utils/auth/required-passkey.fixture';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { storeBrowserPolicy } from '../utils/session/store-browser-policy';
import { MagicLinkStore } from '../../src/auth/magic-link/stores/magic-link.store';
import { hashMagicLinkToken } from '../../src/auth/magic-link/utils/magic-link-token.util';
import { UserProfileService } from '../../src/user/services/user-profile.service';
import { LinkedAccountStore } from '../../src/user/stores/linked-account.store';
import {
  AudienceProvider,
  BAD_PROVIDER_CODE,
  providerReply,
} from '../utils/auth/audience-provider.fixture';

const LOGIN = '/api/auth/login';
const ACTIVATE = '/api/auth/activate';
const NEW_EMAIL = 'required-passkey-activation@example.test';
const LINK_REQUEST = '/api/auth/magic-link/request';
const LINK_VERIFY = '/api/auth/magic-link/verify';
const BAD_LINK_TOKEN = 'invalid-link-token';

// Failure: another credential issues a session where a verified passkey is required.
describe('required web passkey credential refusals', () => {
  let e2e: E2eApp;
  let restoreSecondFactor: (() => void) | undefined;
  const provider = new AudienceProvider();

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      browserStrategy: provider,
      magicLinkEnabled: true,
      beforeStart: (app) => {
        const config = app.get(ConfigService);
        config.set('passkeys.enabled', true);
      },
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    const config = e2e.app.get(ConfigService);
    const enabled = config.get<boolean>('twoFactor.enabled');
    const encryptionKey = config.get<string>('twoFactor.encryptionKey');
    restoreSecondFactor = () => {
      config.set('twoFactor.enabled', enabled);
      config.set('twoFactor.encryptionKey', encryptionKey);
    };
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    await requireWebPasskey(e2e);
  });

  afterEach(() => {
    restoreSecondFactor?.();
    restoreSecondFactor = undefined;
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  // Failure: a correct password opens a session or second-factor challenge.
  it.each([false, true])(
    'refuses password before second factor, stored passkey %s',
    async (hasPasskey) => {
      if (hasPasskey) await storeExistingPasskey(e2e);
      await oweSecondFactor(e2e);
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
      expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(0);
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
    // The check spends one guess before the policy refuses, like a wrong code.
    expect(await e2e.state.auth.pendingRegistrationFor(NEW_EMAIL)).toEqual({
      ...before,
      attempts: 1,
    });
  });

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
});
