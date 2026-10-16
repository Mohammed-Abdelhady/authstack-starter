import { ConfigService } from '@nestjs/config';
import request, { type Response } from 'supertest';
import {
  assertionCredential,
  createSoftwareAuthenticator,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  type SoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import { SEED_USER } from '../constants/seed-users';
import { anonymousPost } from '../utils/auth/audience-refusal.fixtures';
import {
  bootE2eApp,
  E2E_CLIENT_URL,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

/** A host of its own, so the admin relying party cannot pass for the web one. */
const ADMIN_URL = 'http://admin.localhost:3108';
const ADMIN_RP_ID = 'admin.localhost';
const LOGIN = '/api/auth/passkeys/login';
const REGISTER = '/api/auth/passkeys/register';
const FIXTURE_HOST = '127.0.0.1';
/** Written out, so a renamed cookie cannot agree with itself. */
const WEB_CHALLENGE = 'pk_challenge';
const ADMIN_CHALLENGE = 'pk_challenge-admin';
/** The right shape for the routes and no real authenticator's answer. */
const UNSIGNED = {
  id: 'YmluZGluZy1jcmVkZW50aWFs',
  rawId: 'YmluZGluZy1jcmVkZW50aWFs',
  response: {},
  clientExtensionResults: {},
  type: 'public-key',
};

function codeOf(answer: Response): string | undefined {
  return (answer.body as { error?: { code?: string } }).error?.code;
}

/** The value of the named cookie an answer set. */
function cookieValue(answer: Response, name: string): string {
  const written: unknown = answer.headers['set-cookie'];
  const cookie = (Array.isArray(written) ? written.map(String) : []).find(
    (value) => value.startsWith(`${name}=`),
  );
  if (!cookie) throw new Error(`The answer set no ${name} cookie`);
  return cookie.split(';')[0].slice(name.length + 1);
}

describe('passkey challenges keep their browser application (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) => {
        const config = app.get(ConfigService);
        config.set('passkeys.enabled', true);
        config.set('cors.adminUrl', ADMIN_URL);
      },
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    await e2e.state.auth.removeEveryPasskey();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  /** Sign-in options from a page of `origin`, and the challenge it set. */
  async function loginChallenge(origin: string, cookie: string) {
    const options = await anonymousPost(
      e2e,
      `${LOGIN}/options`,
      {},
      request.agent(e2e.httpServer),
      origin,
    );
    expect(options.status).toBe(200);
    const { challenge, rpId } = (
      options.body as { data: { challenge: string; rpId: string } }
    ).data;
    return { challenge, rpId, value: cookieValue(options, cookie) };
  }

  /** A sign-in from a fresh browser on `origin` holding only `cookie`. */
  function loginVerify(origin: string, cookie: string, body: object) {
    const browser = request.agent(e2e.httpServer);
    browser.jar.setCookie(`${cookie}; Path=/`, FIXTURE_HOST, '/');
    return anonymousPost(e2e, `${LOGIN}/verify`, body, browser, origin);
  }

  // Failure: a challenge one application handed out completes a sign-in, and
  // so issues a session, in the other.
  it('refuses a sign-in challenge under the other application cookie, both ways', async () => {
    const web = await loginChallenge(E2E_CLIENT_URL, WEB_CHALLENGE);
    const admin = await loginChallenge(ADMIN_URL, ADMIN_CHALLENGE);
    const body = { response: UNSIGNED };

    const webAsAdmin = await loginVerify(
      ADMIN_URL,
      `${ADMIN_CHALLENGE}=${web.value}`,
      body,
    );
    const adminAsWeb = await loginVerify(
      E2E_CLIENT_URL,
      `${WEB_CHALLENGE}=${admin.value}`,
      body,
    );
    // Each in its own place gets past the challenge and fails on the key.
    const adminAsAdmin = await loginVerify(
      ADMIN_URL,
      `${ADMIN_CHALLENGE}=${admin.value}`,
      body,
    );

    expect([webAsAdmin, adminAsWeb, adminAsAdmin].map(codeOf)).toEqual([
      ErrorCode.PASSKEY_CHALLENGE_INVALID,
      ErrorCode.PASSKEY_CHALLENGE_INVALID,
      ErrorCode.PASSKEY_VERIFICATION_FAILED,
    ]);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  // Failure: the admin application signs in with the web relying party, so
  // its own passkeys never work and a web passkey opens it.
  it('signs in to admin with an admin passkey only', async () => {
    const adminKey = createSoftwareAuthenticator(Buffer.from('admin-rp-key'));
    const webKey = createSoftwareAuthenticator(Buffer.from('web-rp-key'));
    for (const [key, rpId] of [
      [adminKey, ADMIN_RP_ID],
      [webKey, undefined],
    ] as const) {
      await e2e.state.auth.storePasskey(SEED_USER.email, {
        credentialId: key.credentialId,
        publicKey: key.cosePublicKey,
        counter: 0,
        transports: ['internal'],
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'Binding key',
        lastUsedAt: null,
        ...(rpId ? { rpId } : {}),
      });
    }
    const signIn = async (key: SoftwareAuthenticator) => {
      const { challenge, rpId, value } = await loginChallenge(
        ADMIN_URL,
        ADMIN_CHALLENGE,
      );
      expect(rpId).toBe(ADMIN_RP_ID);
      const response = assertionCredential(key, {
        challenge,
        rpId,
        origin: ADMIN_URL,
        flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
        counter: 1,
      });
      return loginVerify(ADMIN_URL, `${ADMIN_CHALLENGE}=${value}`, {
        response,
      });
    };

    const web = await signIn(webKey);
    const admin = await signIn(adminKey);

    expect(codeOf(web)).toBe(ErrorCode.PASSKEY_VERIFICATION_FAILED);
    expect(admin.status).toBe(200);
    const name = e2e.app.get(SessionCookieService).nameFor(ADMIN_CLIENT_ID);
    expect(cookieValue(admin, name)).not.toBe('');
  });

  /** An admin session the session service issued, on a browser of its own. */
  async function adminSession() {
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('The seed account is missing');
    const issued = await e2e.app
      .get(Sessions)
      .createSession(userId, 'Fixture/1', FIXTURE_HOST, ADMIN_CLIENT_ID);
    const name = e2e.app.get(SessionCookieService).nameFor(ADMIN_CLIENT_ID);
    const browser = request.agent(e2e.httpServer);
    browser.jar.setCookie(
      `${name}=${issued.sessionToken}; Path=/; HttpOnly`,
      FIXTURE_HOST,
      '/',
    );
    return {
      browser,
      post: (path: string, body: object): Promise<Response> =>
        browser
          .post(path)
          .set('Origin', ADMIN_URL)
          .set(CSRF_HEADER, issued.csrfToken)
          .send(body),
    };
  }

  /** Registration options on a signed-in browser, and the cookie they set. */
  async function registrationChallenge(
    post: (path: string, body: object) => Promise<Response>,
    cookie: string,
  ): Promise<string> {
    const options = await post(`${REGISTER}/options`, {
      password: SEED_USER.password,
    });
    expect(options.status).toBe(200);
    return cookieValue(options, cookie);
  }

  // Failure: a registration challenge one application handed out stores a
  // passkey through the other.
  it('refuses a registration challenge under the other application cookie, both ways', async () => {
    const web: TestAgent = await loginAs(e2e.httpServer, SEED_USER);
    const postAsWeb = (path: string, body: object): Promise<Response> =>
      web.post(path).send(body);
    const admin = await adminSession();
    const webValue = await registrationChallenge(postAsWeb, WEB_CHALLENGE);
    const adminValue = await registrationChallenge(admin.post, ADMIN_CHALLENGE);
    const body = { response: UNSIGNED };

    web.jar.setCookie(
      `${WEB_CHALLENGE}=${adminValue}; Path=/`,
      FIXTURE_HOST,
      '/',
    );
    admin.browser.jar.setCookie(
      `${ADMIN_CHALLENGE}=${webValue}; Path=/`,
      FIXTURE_HOST,
      '/',
    );
    const adminUnderWeb = await postAsWeb(`${REGISTER}/verify`, body);
    const webUnderAdmin = await admin.post(`${REGISTER}/verify`, body);

    expect([adminUnderWeb, webUnderAdmin].map(codeOf)).toEqual([
      ErrorCode.PASSKEY_CHALLENGE_INVALID,
      ErrorCode.PASSKEY_CHALLENGE_INVALID,
    ]);
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
  });
});
