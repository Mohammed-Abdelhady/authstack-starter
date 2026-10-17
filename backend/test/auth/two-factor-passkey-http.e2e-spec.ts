import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import {
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  assertionCredential,
  createSoftwareAuthenticator,
  type SoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
} from '../utils/audience-authorization.fixtures';
import {
  anonymousPost,
  expectNoAuthority,
  reply,
} from '../utils/auth/audience-refusal.fixtures';
import {
  answerSecondStep,
  applyTwoFactorEnv,
  enrolTwoFactor,
  passwordFirstStep,
} from '../utils/auth/two-factor-enrolment';
import {
  bootE2eApp,
  E2E_CLIENT_URL,
  loginAs,
  type E2eApp,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const STEP = new Date('2099-01-01T12:00:00.000Z');

describe('passkey answer to a held two-step sign-in (e2e)', () => {
  let e2e: E2eApp;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = applyTwoFactorEnv();
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
    restoreEnv();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    await e2e.state.auth.removeEveryPasskey();
    jest.useFakeTimers({
      now: STEP,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function heldAnswer(flags: number, keyOwner = SEED_USER.email) {
    const owner = await loginAs(e2e.httpServer, SEED_USER);
    await enrolTwoFactor(owner, SEED_USER.password, STEP);
    const authenticator = createSoftwareAuthenticator(
      Buffer.from('second-factor-http-key'),
    );
    await e2e.state.auth.storePasskey(keyOwner, {
      credentialId: authenticator.credentialId,
      publicKey: authenticator.cosePublicKey,
      counter: 0,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Security key',
      lastUsedAt: null,
    });
    const { agent, response } = await passwordFirstStep(
      e2e.httpServer,
      SEED_USER,
    );
    expect(response.status).toBe(200);
    const browserProof = await agent.get('/api/auth/browser-proof').expect(200);
    const token = (browserProof.body as { data: { token: string } }).data.token;
    const options = await agent
      .post('/api/auth/passkeys/login/options')
      .set(CSRF_HEADER, token)
      .send({})
      .expect(200);
    const data = options.body as {
      data: { challenge: string; rpId: string };
    };
    const credential = assertionCredential(authenticator, {
      challenge: data.data.challenge,
      rpId: data.data.rpId,
      origin: E2E_CLIENT_URL,
      flags,
      counter: 1,
    });
    const answer = await answerSecondStep(agent, {
      passkeyResponse: credential,
    });
    return { agent, answer };
  }

  it('finishes the password challenge with a user-verified passkey', async () => {
    const { agent, answer } = await heldAnswer(
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
    );
    expect(answer.status).toBe(200);
    const cookieName = e2e.app.get(SessionCookieService, {
      strict: false,
    }).name;
    expect(answer.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`^${cookieName}=`)),
      ]),
    );
    await agent.get('/api/user/profile').expect(200);
  });

  it('refuses another account’s passkey', async () => {
    const { agent, answer } = await heldAnswer(
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      SEED_ADMIN.email,
    );
    expect(answer.status).toBe(401);
    expect((answer.body as { error: { code: string } }).error.code).toBe(
      ErrorCode.PASSKEY_VERIFICATION_FAILED,
    );
    await agent.get('/api/user/profile').expect(401);
  });

  // Failure: a customer's valid passkey answering the second step on the
  // staff-only admin application is told apart from a wrong passkey.
  it('matches a wrong-passkey reply when admission changes during the challenge', async () => {
    const config = e2e.app.get(ConfigService);
    const previous = [
      'cors.adminUrl',
      'passkeys.rpId',
      'passkeys.origin',
      'auth.admin.signIn',
      'auth.web.signIn',
    ].map((key) => [key, config.get<unknown>(key)] as const);
    try {
      config.set('cors.adminUrl', ADMIN_ORIGIN);
      config.set('passkeys.rpId', new URL(ADMIN_ORIGIN).hostname);
      config.set('passkeys.origin', ADMIN_ORIGIN);
      await arrangeAudiences(e2e);
      const owner = await loginAs(e2e.httpServer, SEED_USER);
      await enrolTwoFactor(owner, SEED_USER.password, STEP);
      const key = createSoftwareAuthenticator(
        Buffer.from('audience-second-factor-key'),
      );
      const unknown = createSoftwareAuthenticator(
        Buffer.from('unknown-second-factor-key'),
      );
      await e2e.state.auth.storePasskey(SEED_USER.email, {
        credentialId: key.credentialId,
        publicKey: key.cosePublicKey,
        counter: 0,
        transports: ['internal'],
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'Security key',
        lastUsedAt: null,
        rpId: new URL(ADMIN_ORIGIN).hostname,
      });
      config.set('auth.admin.signIn', { signUp: 'closed' });
      await reconcileStartupApplications(e2e.app);
      const browser = request.agent(e2e.httpServer);
      const first = await anonymousPost(
        e2e,
        '/api/auth/login',
        SEED_USER,
        browser,
      );
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ data: { requiresTwoFactor: true } });
      const answer = async (
        authenticator: SoftwareAuthenticator,
        counter: number,
      ) => {
        const options = await anonymousPost(
          e2e,
          '/api/auth/passkeys/login/options',
          {},
          browser,
        );
        expect(options.status).toBe(200);
        const { data } = options.body as {
          data: { challenge: string; rpId: string };
        };
        const credential = assertionCredential(authenticator, {
          challenge: data.challenge,
          rpId: data.rpId,
          origin: ADMIN_ORIGIN,
          flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
          counter,
        });
        return anonymousPost(
          e2e,
          '/api/auth/2fa/verify',
          { passkeyResponse: credential },
          browser,
        );
      };
      const beforeSessions = await e2e.state.sessions.countSessions();
      const wrong = await answer(unknown, 1);
      config.set('auth.admin.signIn', {
        audience: ROLE_AUDIENCE.STAFF,
        signUp: 'closed',
      });
      await reconcileStartupApplications(e2e.app);
      const refused = await answer(key, 1);
      expect(reply(refused)).toEqual(reply(wrong));
      expect(wrong.status).toBe(401);
      expect(wrong.body).toMatchObject({
        error: { code: ErrorCode.PASSKEY_VERIFICATION_FAILED },
      });
      expectNoAuthority(e2e, refused);
      expect(await e2e.state.sessions.countSessions()).toBe(beforeSessions);
      config.set('auth.admin.signIn', { signUp: 'closed' });
      await reconcileStartupApplications(e2e.app);
      const admitted = await answer(key, 2);
      expect(admitted.status).toBe(200);
      expect(admitted.body).toMatchObject({
        data: { requiresTwoFactor: false, user: { email: SEED_USER.email } },
      });
      expect(await e2e.state.sessions.countSessions()).toBe(beforeSessions + 1);
    } finally {
      for (const [key, value] of previous) config.set(key, value);
    }
  });
});
