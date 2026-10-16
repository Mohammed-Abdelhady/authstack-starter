import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import {
  assertionCredential,
  createSoftwareAuthenticator,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  type SoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { SEED_USER } from '../constants/seed-users';
import {
  anonymousPost,
  expectNoAuthority,
} from '../utils/auth/audience-refusal.fixtures';
import { bootE2eApp, E2E_CLIENT_URL, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { storedBrowserSession } from '../utils/session/stored-browser-session';

const LOGIN = '/api/auth/passkeys/login';
const PASSKEYS = '/api/auth/passkeys';

// Failure: a required passkey keeps the server from starting, or a passkey
// that did not verify its user opens the application.
describe('an application that requires a passkey', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) => {
        const config = app.get(ConfigService);
        config.set('passkeys.enabled', true);
        config.set('auth.web.signIn', { requirePasskey: true });
      },
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  /** Stores a passkey for the seed account and hands back its id. */
  function storeKey(key: SoftwareAuthenticator): Promise<string> {
    return e2e.state.auth.storePasskey(SEED_USER.email, {
      credentialId: key.credentialId,
      publicKey: key.cosePublicKey,
      counter: 0,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Required key',
      lastUsedAt: null,
    });
  }

  async function signIn(
    key: SoftwareAuthenticator,
    flags: number,
    counter: number,
    browser = request.agent(e2e.httpServer),
  ) {
    const options = await anonymousPost(
      e2e,
      `${LOGIN}/options`,
      {},
      browser,
      E2E_CLIENT_URL,
    );
    expect(options.status).toBe(200);
    const { challenge, rpId } = (
      options.body as { data: { challenge: string; rpId: string } }
    ).data;
    return anonymousPost(
      e2e,
      `${LOGIN}/verify`,
      {
        response: assertionCredential(key, {
          challenge,
          rpId,
          origin: E2E_CLIENT_URL,
          flags,
          counter,
        }),
      },
      browser,
      E2E_CLIENT_URL,
    );
  }

  it('starts, and lets in only a passkey that verified its user', async () => {
    const key = createSoftwareAuthenticator(
      Buffer.from('required-passkey-startup'),
    );
    await storeKey(key);

    const unverified = await signIn(key, FLAG_USER_PRESENT, 1);
    expect(unverified.status).toBe(401);
    expect(unverified.body).toMatchObject({
      error: { code: ErrorCode.PASSKEY_VERIFICATION_FAILED },
    });
    expectNoAuthority(e2e, unverified);
    expect(await e2e.state.sessions.countSessions()).toBe(0);

    const verified = await signIn(
      key,
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      2,
    );
    expect(verified.status).toBe(200);
    const name = e2e.app.get(SessionCookieService).nameFor(WEB_CLIENT_ID);
    const cookie = (verified.get('Set-Cookie') ?? []).find((value) =>
      value.startsWith(`${name}=`),
    );
    if (!cookie) throw new Error('The passkey sign-in set no session cookie');
    expect(
      await storedBrowserSession(e2e.app, cookie.split(';')[0]),
    ).toMatchObject({
      clientId: WEB_CLIENT_ID,
      authenticationMethods: ['passkey'],
      userVerified: true,
    });
  });

  // Failure: a password left on the account lets the last passkey the
  // application requires go, and the account can no longer sign in there.
  it('keeps the last passkey the application requires, password or not', async () => {
    const key = createSoftwareAuthenticator(
      Buffer.from('required-passkey-removal'),
    );
    const passkeyId = await storeKey(key);
    const browser = request.agent(e2e.httpServer);
    const signedIn = await signIn(
      key,
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      1,
      browser,
    );
    expect(signedIn.status).toBe(200);
    const csrf: unknown = signedIn.headers[CSRF_HEADER];
    if (typeof csrf !== 'string') throw new Error('No CSRF token was issued');
    const remove = () =>
      browser
        .delete(`${PASSKEYS}/${passkeyId}`)
        .set('Origin', E2E_CLIENT_URL)
        .set(CSRF_HEADER, csrf);

    const kept = await remove();
    expect(kept.status).toBe(409);
    expect(kept.body).toMatchObject({
      error: { code: ErrorCode.PASSKEY_LAST_SIGN_IN_METHOD },
    });
    expect(await e2e.state.auth.countPasskeys()).toBe(1);

    await storeKey(
      createSoftwareAuthenticator(Buffer.from('required-passkey-spare')),
    );
    expect((await remove()).status).toBe(200);
    expect(await e2e.state.auth.countPasskeys()).toBe(1);
  });
});
