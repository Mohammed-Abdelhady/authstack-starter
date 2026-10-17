import { randomBytes } from 'node:crypto';
import request, { type Response } from 'supertest';
import {
  attestationCredential,
  createSoftwareAuthenticator,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../../src/session/constants/credential-purpose';
import { SEED_USER } from '../constants/seed-users';
import { expectNoAuthority } from '../utils/auth/audience-refusal.fixtures';
import type { E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  bootEnrolmentApp,
  ENROLMENT_ORIGIN,
  ENROLMENT_RP_ID,
  issueEnrolment,
  type IssuedEnrolment,
} from '../utils/session/enrolment-fixtures';
import { storeBrowserPolicy } from '../utils/session/store-browser-policy';

const MINUTE_MS = 60_000;
const OPTIONS = '/api/auth/passkeys/register/options';
const VERIFY = '/api/auth/passkeys/register/verify';
const CHALLENGE_COOKIE = 'pk_challenge';
/** Fakes only the date: the five-minute rule reads it, the database drivers need real timers. */
const ONLY_THE_CALENDAR = [
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
] as const;

/** A request on the enrolment session, with any further cookies. */
function onEnrolment(
  e2e: E2eApp,
  path: string,
  issued: IssuedEnrolment,
  cookies: string[] = [],
) {
  return request(e2e.httpServer)
    .post(path)
    .set('Origin', ENROLMENT_ORIGIN)
    .set('Cookie', [issued.cookie, ...cookies].join('; '))
    .set(CSRF_HEADER, issued.csrfToken);
}

/** The challenge cookie an options answer set, as the browser would send it back. */
function challengeCookieOf(answer: Response): string {
  const written: unknown = answer.headers['set-cookie'];
  const cookie = (Array.isArray(written) ? written.map(String) : []).find(
    (value) => value.startsWith(`${CHALLENGE_COOKIE}=`),
  );
  if (!cookie) throw new Error('The options answer set no challenge cookie');
  return cookie.split(';')[0];
}

/** Options, a user-verified attestation for the web relying party, then verify. */
async function register(e2e: E2eApp, issued: IssuedEnrolment) {
  const options = await onEnrolment(e2e, OPTIONS, issued).send({});
  expect(options.status).toBe(200);
  const response = attestationCredential(
    createSoftwareAuthenticator(randomBytes(32)),
    {
      rpId: ENROLMENT_RP_ID,
      origin: ENROLMENT_ORIGIN,
      challenge: (options.body as { data: { challenge: string } }).data
        .challenge,
      flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      counter: 0,
    },
  );
  const challengeCookie = challengeCookieOf(options);
  return {
    send: () =>
      onEnrolment(e2e, VERIFY, issued, [challengeCookie]).send({ response }),
  };
}

// Failure: an expired enrolment reaches passkey registration and creates authority.
describe('enrolment registration expiry', () => {
  let e2e: E2eApp;
  let startedAt: number;
  beforeAll(async () => {
    e2e = await bootEnrolmentApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    // Without a password, the five-minute rule is the proof a session owes.
    await e2e.state.auth.removePassword(SEED_USER.email);
    startedAt = Date.now();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  /** Moves the issuing clock and the date the five-minute rule reads together. */
  function minute(minutes: number): void {
    e2e.clock.set(new Date(TEST_NOW.getTime() + minutes * MINUTE_MS));
    jest.useFakeTimers({
      now: startedAt + minutes * MINUTE_MS,
      doNotFake: [...ONLY_THE_CALENDAR],
    });
  }

  it('refuses fresh registration options at minute 16 without creating authority', async () => {
    const issued = await issueEnrolment(e2e);
    e2e.clock.advance(16 * MINUTE_MS);
    await request(e2e.httpServer)
      .post(OPTIONS)
      .set('Origin', ENROLMENT_ORIGIN)
      .set('Cookie', issued.cookie)
      .set(CSRF_HEADER, issued.csrfToken)
      .send({})
      .expect(401);
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
    expect(await e2e.app.get(Sessions).getUserSessions(issued.userId)).toEqual(
      [],
    );
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
    ).toBeNull();
  });

  // Failure: the five-minute rule strands an enrolment session, or a
  // registration on it leaves the account without a full session.
  it.each([6, 14])(
    'registers at minute %i and hands over a full session in place of the enrolment',
    async (minutes) => {
      const issued = await issueEnrolment(e2e);
      minute(minutes);
      const registration = await register(e2e, issued);

      const verified = await registration.send();

      expect(verified.status).toBe(200);
      const name = e2e.app.get(SessionCookieService).nameFor(WEB_CLIENT_ID);
      const written: unknown = verified.headers['set-cookie'];
      const sessionCookie = (
        Array.isArray(written) ? written.map(String) : []
      ).find((value) => value.startsWith(`${name}=`));
      if (!sessionCookie) throw new Error('The registration set no session');
      const token = decodeURIComponent(
        sessionCookie.split(';')[0].slice(name.length + 1),
      );
      expect(token).not.toBe(issued.sessionToken);
      const sessions = e2e.app.get(Sessions);
      expect(await sessions.validateSession(token)).toMatchObject({
        userId: issued.userId,
        clientId: WEB_CLIENT_ID,
        credentialPurpose: CREDENTIAL_PURPOSE.BROWSER_SESSION,
        authenticationMethods: ['passkey'],
        userVerified: true,
        csrfToken: verified.headers[CSRF_HEADER],
      });
      expect(
        await sessions.validateBrowserSession(issued.sessionToken),
      ).toBeNull();
      expect(await e2e.state.auth.countPasskeys()).toBe(1);
    },
  );

  it('refuses at minute 16 a registration whose options came at minute 14', async () => {
    const issued = await issueEnrolment(e2e);
    minute(14);
    const registration = await register(e2e, issued);
    minute(16);

    const refused = await registration.send();

    expect(refused.status).toBe(401);
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
    expect(await e2e.app.get(Sessions).getUserSessions(issued.userId)).toEqual(
      [],
    );
  });

  // Failure: a promotion refused after the passkey was inserted keeps the
  // passkey or hands out a cookie, or loses the refusal's audit event.
  it('stores nothing and sets no session when the audience changes before verify', async () => {
    const issued = await issueEnrolment(e2e);
    const registration = await register(e2e, issued);
    await storeBrowserPolicy(
      e2e,
      WEB_CLIENT_ID,
      { accountAudience: ROLE_AUDIENCE.STAFF },
      false,
    );

    const refused = await registration.send();

    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({
      error: { code: 'PASSKEY_CHALLENGE_INVALID' },
    });
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
    const stored = e2e.state.enrolment;
    expect(await stored.audienceRefusals(issued.userId)).toEqual([
      { clientId: WEB_CLIENT_ID, outcome: 'failed' },
    ]);
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
    ).toMatchObject({
      id: issued.session.id,
      credentialPurpose: CREDENTIAL_PURPOSE.ENROLMENT,
    });
  });
});
