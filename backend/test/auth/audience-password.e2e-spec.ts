import { ConfigService } from '@nestjs/config';
// feature:passkeys:start
import request from 'supertest';
import {
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  assertionCredential,
  createSoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
// feature:passkeys:end
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
} from '../utils/audience-authorization.fixtures';
import {
  addressReply,
  anonymousPost,
  expectNoAuthority,
  reply,
} from '../utils/auth/audience-refusal.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const UNKNOWN_EMAIL = 'closed-admin-new@example.test';
const ACTIVATE = '/api/auth/activate';
const PASSKEY_LOGIN = '/api/auth/passkeys/login'; // feature:passkeys

// Failure: admin self-registration creates a new staff identity or leaks a correct password.
describe('closed admin password entry points', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
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

  it.each(['/api/auth/register', '/api/auth/resend-activation'])(
    'keeps %s replies and mail observation equal for known and unknown addresses',
    async (path) => {
      const known = await anonymousPost(e2e, path, {
        email: SEED_ADMIN.email,
      });
      const knownMail = (await e2e.captureMail()).length;
      const unknown = await anonymousPost(e2e, path, {
        email: UNKNOWN_EMAIL,
      });
      const unknownMail = (await e2e.captureMail()).length - knownMail;
      expect(addressReply(unknown)).toEqual(addressReply(known));
      expect(known.status).toBe(200);
      expect({ knownMail, unknownMail }).toEqual({
        knownMail: 0,
        unknownMail: 0,
      });
      expect(
        await e2e.state.auth.countPendingRegistrations(UNKNOWN_EMAIL),
      ).toBe(0);
      expect(await e2e.state.accounts.accountIdFor(UNKNOWN_EMAIL)).toBeNull();
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expectNoAuthority(e2e, known);
      expectNoAuthority(e2e, unknown);
    },
  );

  // Failure: an old instance's open config bypasses a policy already closed in storage.
  it('keeps persisted closure authoritative while local configuration still says open', async () => {
    const applications = e2e.app.get(ApplicationRegistry);
    expect((await applications.findByClientId(ADMIN_CLIENT_ID))?.signUp).toBe(
      'closed',
    );
    e2e.app.get(ConfigService).set('auth.admin.signIn', { signUp: 'open' });
    const refused = await anonymousPost(e2e, '/api/auth/register', {
      email: UNKNOWN_EMAIL,
    });
    expect(refused.status).toBe(200);
    expect(await e2e.state.auth.countPendingRegistrations(UNKNOWN_EMAIL)).toBe(
      0,
    );
    expect(await e2e.state.accounts.accountIdFor(UNKNOWN_EMAIL)).toBeNull();
    expect(await e2e.captureMail()).toEqual([]);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expectNoAuthority(e2e, refused);
    expect((await applications.findByClientId(ADMIN_CLIENT_ID))?.signUp).toBe(
      'closed',
    );
  });

  it('answers an audience refusal exactly like the same account with a wrong password', async () => {
    const wrong = await anonymousPost(e2e, '/api/auth/login', {
      ...SEED_USER,
      password: 'WrongPassword1!',
    });
    const refused = await anonymousPost(e2e, '/api/auth/login', SEED_USER);
    expect(reply(refused)).toEqual(reply(wrong));
    expect(wrong.status).toBe(401);
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect(await e2e.captureMail()).toEqual([]);
  });

  // feature:passkeys:start
  // Failure: a valid passkey reveals an excluded audience or receives a session.
  it.each([FLAG_USER_PRESENT, FLAG_USER_PRESENT | FLAG_USER_VERIFIED])(
    'answers an audience refusal like a wrong passkey with flags %i',
    async (flags) => {
      const config = e2e.app.get(ConfigService);
      config.set('passkeys.enabled', true);
      config.set('passkeys.rpId', new URL(ADMIN_ORIGIN).hostname);
      config.set('passkeys.origin', ADMIN_ORIGIN);
      const authenticator = createSoftwareAuthenticator(
        Buffer.from('audience-customer-passkey'),
      );
      const unknown = createSoftwareAuthenticator(
        Buffer.from('audience-unknown-passkey'),
      );
      await e2e.state.auth.storePasskey(SEED_USER.email, {
        credentialId: authenticator.credentialId,
        publicKey: authenticator.cosePublicKey,
        counter: 0,
        transports: ['internal'],
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'Audience key',
        lastUsedAt: null,
      });
      const attempt = async (key: typeof authenticator, counter: number) => {
        const browser = request.agent(e2e.httpServer);
        const options = await anonymousPost(
          e2e,
          `${PASSKEY_LOGIN}/options`,
          {},
          browser,
        );
        expect(options.status).toBe(200);
        const { challenge, rpId } = (
          options.body as { data: { challenge: string; rpId: string } }
        ).data;
        return anonymousPost(
          e2e,
          `${PASSKEY_LOGIN}/verify`,
          {
            response: assertionCredential(key, {
              challenge,
              rpId,
              origin: ADMIN_ORIGIN,
              flags,
              counter,
            }),
          },
          browser,
        );
      };
      const wrong = await attempt(unknown, 1);
      const refused = await attempt(authenticator, 1);
      expect(reply(refused)).toEqual(reply(wrong));
      expect(wrong.status).toBe(401);
      expect(wrong.body).toMatchObject({
        error: { code: ErrorCode.PASSKEY_VERIFICATION_FAILED },
      });
      expectNoAuthority(e2e, refused);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      config.set('auth.admin.signIn', {
        audience: ROLE_AUDIENCE.CUSTOMER,
        signUp: 'closed',
      });
      await reconcileStartupApplications(e2e.app);
      const admitted = await attempt(authenticator, 2);
      expect(admitted.status).toBe(200);
      expect(admitted.body).toMatchObject({
        data: { requiresTwoFactor: false, user: { email: SEED_USER.email } },
      });
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    },
  );
  // feature:passkeys:end

  it('refuses a valid pre-closure activation code like an invalid code and retains it', async () => {
    const config = e2e.app.get(ConfigService);
    config.set('auth.admin.signIn', {});
    await reconcileStartupApplications(e2e.app);
    await anonymousPost(e2e, '/api/auth/register', {
      email: UNKNOWN_EMAIL,
    });
    const code = await e2e.mailedCode();
    const before = await e2e.state.auth.pendingRegistrationFor(UNKNOWN_EMAIL);
    config.set('auth.admin.signIn', {
      audience: ROLE_AUDIENCE.STAFF,
      signUp: 'closed',
    });
    await reconcileStartupApplications(e2e.app);
    const body = {
      email: UNKNOWN_EMAIL,
      password: 'ActivatedPassword1!',
      name: 'Refused Staff',
    };
    const wrongCode = code === '000000' ? '000001' : '000000';
    const wrong = await anonymousPost(e2e, ACTIVATE, {
      ...body,
      email: SEED_ADMIN.email,
      code: wrongCode,
    });
    const pendingAfterWrong =
      await e2e.state.auth.pendingRegistrationFor(UNKNOWN_EMAIL);
    const refused = await anonymousPost(e2e, ACTIVATE, { ...body, code });
    expect(reply(refused)).toEqual(reply(wrong));
    expect(wrong.status).toBe(400);
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.accounts.accountIdFor(UNKNOWN_EMAIL)).toBeNull();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect(await e2e.state.auth.pendingRegistrationFor(UNKNOWN_EMAIL)).toEqual(
      pendingAfterWrong,
    );
    expect(pendingAfterWrong?.hashedCode).toBe(before?.hashedCode);
  });

  it('continues signing a known admitted staff account in on a closed application', async () => {
    const signedIn = await anonymousPost(e2e, '/api/auth/login', SEED_ADMIN);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({
      data: { requiresTwoFactor: false, user: { email: SEED_ADMIN.email } },
    });
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });
});
