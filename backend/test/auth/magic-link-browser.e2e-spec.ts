import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import { storedBrowserSession } from '../utils/session/stored-browser-session';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { ConfigService } from '@nestjs/config';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import { describeMagicLinkCreationGate } from './magic-link-creation-gate.harness-spec';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const ADMIN_ORIGIN = 'http://admin.example.test';

const NONCE_COOKIE =
  /^ml_nonce=[A-Za-z0-9_-]{43}; Max-Age=900; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Strict$/;
const CLEARED_NONCE =
  /^ml_nonce=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict$/;

describeMagicLinkCreationGate();

interface VerifyBody {
  success: boolean;
  data: {
    requiresTwoFactor: boolean;
    requiresConfirmation?: boolean;
    email?: string;
    user: { email: string } | null;
  };
}

describe('magic link and the browser that asked for it (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) => {
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN);
      },
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    e2e.app.get(ConfigService).set('magicLink.enabled', true);
  });

  /** Asks for a link from this browser and hands back what the answer set. */
  async function ask(
    browser: TestAgent,
    email = SEED_USER.email,
    origin?: string,
  ): Promise<{ token: string; cookies: string[]; link: string }> {
    const request = browser.post('/api/auth/magic-link/request');
    if (origin) {
      request.set('Origin', origin);
      request.set(CSRF_HEADER, await proofFor(browser, origin));
    }
    const answer = await request.send({ email }).expect(200);
    const link = (await e2e.captureMail())
      .at(-1)
      ?.text?.match(/https?:\/\/[^\s]+/)?.[0];
    const token = link ? new URL(link).searchParams.get('token') : null;
    if (!token || !link) throw new Error('Magic link mail has no token');
    return { token, cookies: answer.get('Set-Cookie') ?? [], link };
  }

  /** Opens a link from a signed-out browser, with a proof of its own. */
  const open = async (
    browser: TestAgent,
    body: Record<string, unknown>,
    origin?: string,
    proofOrigin = origin,
  ) => {
    const proof = await proofFor(browser, proofOrigin);
    const request = browser
      .post('/api/auth/magic-link/verify')
      .set(CSRF_HEADER, proof);
    if (origin) request.set('Origin', origin);
    return request.send(body);
  };
  /** Opens a link from a browser whose session carries its own proof. */
  const openSignedIn = (browser: TestAgent, body: Record<string, unknown>) =>
    browser.post('/api/auth/magic-link/verify').send(body);

  const whoAmI = async (browser: TestAgent): Promise<string | number> => {
    const profile = await browser.get('/api/user/profile');
    return profile.status === 200
      ? (profile.body as { data: { email: string } }).data.email
      : profile.status;
  };

  it('signs in at once in the browser that asked and takes the nonce cookie back', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { token, cookies } = await ask(browser);

    const opened = await open(browser, { token });
    const nonceCookies = (opened.get('Set-Cookie') ?? []).filter((cookie) =>
      cookie.startsWith('ml_nonce='),
    );

    expect(opened.status).toBe(200);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(NONCE_COOKIE);
    expect((opened.body as VerifyBody).data.user?.email).toBe(SEED_USER.email);
    expect(nonceCookies).toHaveLength(1);
    expect(nonceCookies[0]).toMatch(CLEARED_NONCE);
    expect(await whoAmI(browser)).toBe(SEED_USER.email);
  });

  it('asks another browser to confirm and signs it in only after it did', async () => {
    const asked = await browserAgent(e2e.httpServer);
    const { token } = await ask(asked);
    const other = await browserAgent(e2e.httpServer);

    const first = await open(other, { token });
    const afterFirst = {
      body: first.body as VerifyBody,
      cookies: first.get('Set-Cookie') ?? [],
      sessions: await e2e.state.sessions.countSessions(),
      profile: await whoAmI(other),
    };
    const confirmed = await open(other, { token, confirm: true });
    const replayed = await open(other, { token, confirm: true });

    expect([first.status, confirmed.status]).toEqual([200, 200]);
    expect(afterFirst).toEqual({
      body: {
        success: true,
        data: {
          requiresTwoFactor: false,
          user: null,
          requiresConfirmation: true,
          email: 'u***@seed.local',
        },
        message: 'Confirm this sign-in to continue',
      },
      cookies: [],
      sessions: 0,
      profile: 401,
    });
    expect((confirmed.body as VerifyBody).data.user?.email).toBe(
      SEED_USER.email,
    );
    expect(await whoAmI(other)).toBe(SEED_USER.email);
    expect(replayed.status).toBe(400);
    expect(replayed.body).toMatchObject({
      error: { code: ErrorCode.MAGIC_LINK_INVALID },
    });
  });

  it('keeps the session of another account until the person confirms the switch', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_ADMIN);
    const { token } = await ask(browser);

    const first = await openSignedIn(browser, { token }).expect(200);
    const afterFirst = {
      asksToConfirm: (first.body as VerifyBody).data.requiresConfirmation,
      masked: (first.body as VerifyBody).data.email,
      stillSignedInAs: await whoAmI(browser),
    };
    await openSignedIn(browser, { token, confirm: true }).expect(200);

    expect(afterFirst).toEqual({
      asksToConfirm: true,
      masked: 'u***@seed.local',
      stillSignedInAs: SEED_ADMIN.email,
    });
    expect(await whoAmI(browser)).toBe(SEED_USER.email);
  });

  // Catches prefix tampering changing the application or consuming a valid link.
  it('authenticates the admin token prefix and keeps its application without Origin', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { token, link } = await ask(browser, SEED_USER.email, ADMIN_ORIGIN);
    expect(token).toMatch(
      new RegExp(`^${ADMIN_CLIENT_ID}\\.[A-Za-z0-9_-]{43}$`, 'u'),
    );
    expect(new URL(link).origin).toBe(ADMIN_ORIGIN);

    const tampered = await open(
      browser,
      { token: token.slice(`${ADMIN_CLIENT_ID}.`.length), confirm: true },
      ADMIN_ORIGIN,
    );
    expect(tampered.status).toBe(400);
    expect(tampered.body).toMatchObject({
      error: { code: ErrorCode.MAGIC_LINK_INVALID },
    });

    const opened = await open(
      browser,
      { token, confirm: true },
      undefined,
      ADMIN_ORIGIN,
    );
    expect(opened.status).toBe(200);
    const cookies = opened.get('Set-Cookie') ?? [];
    const names = e2e.app.get(SessionCookieService);
    expect(
      cookies.some((cookie) =>
        cookie.startsWith(`${names.nameFor(ADMIN_CLIENT_ID)}=`),
      ),
    ).toBe(true);
    const sessionCookie = cookies.find((cookie) =>
      cookie.startsWith(`${names.nameFor(ADMIN_CLIENT_ID)}=`),
    );
    if (!sessionCookie) throw new Error('Admin magic link issued no session');
    expect(
      await storedBrowserSession(e2e.app, sessionCookie.split(';')[0]),
    ).toMatchObject({
      clientId: ADMIN_CLIENT_ID,
      authenticationMethods: ['magic_link'],
      userVerified: false,
      policyVersion: 0,
    });
    const admin = await browser
      .get('/api/auth/identity')
      .set('Origin', ADMIN_ORIGIN);
    const web = await browser.get('/api/auth/identity');
    expect(admin.body).toMatchObject({
      data: { authenticated: true, user: { email: SEED_USER.email } },
    });
    expect(web.body).toMatchObject({
      data: { authenticated: false, user: null },
    });
    const replayed = await open(
      browser,
      { token, confirm: true },
      ADMIN_ORIGIN,
    );
    expect(replayed.status).toBe(400);
  });

  // Failure: adding an admin hint turns a web link into admin authority.
  it('refuses promotion of a web token and leaves its web ceremony usable', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { token } = await ask(browser);
    const crossed = await open(
      browser,
      { token: `${ADMIN_CLIENT_ID}.${token}`, confirm: true },
      ADMIN_ORIGIN,
    );
    expect(crossed.status).toBe(400);
    expect(crossed.body).toMatchObject({
      error: { code: ErrorCode.MAGIC_LINK_INVALID },
    });
    const completed = await open(browser, { token, confirm: true });
    expect(completed.status).toBe(200);
    expect(await whoAmI(browser)).toBe(SEED_USER.email);
    const admin = await browser
      .get('/api/auth/identity')
      .set('Origin', ADMIN_ORIGIN);
    expect(admin.body).toMatchObject({
      data: { authenticated: false, user: null },
    });
  });

  // Catches the web session being read or replaced while signing in to admin.
  it('ignores the other application session during the magic-link account-switch check', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_ADMIN);
    const { token } = await ask(browser, SEED_USER.email, ADMIN_ORIGIN);
    const opened = await open(browser, { token }, undefined, ADMIN_ORIGIN);
    expect(opened.status).toBe(200);
    expect(
      (opened.body as VerifyBody).data.requiresConfirmation,
    ).toBeUndefined();
    expect((opened.body as VerifyBody).data.user?.email).toBe(SEED_USER.email);
    expect(await whoAmI(browser)).toBe(SEED_ADMIN.email);
    const admin = await browser
      .get('/api/user/profile')
      .set('Origin', ADMIN_ORIGIN);
    expect(admin.body).toMatchObject({ data: { email: SEED_USER.email } });
  });

  it.each(['true', 'false', 1])(
    'refuses a confirmation sent as %p, which is not a boolean, and spends nothing',
    async (confirm) => {
      const browser = await browserAgent(e2e.httpServer);
      const { token } = await ask(browser);

      const refused = await open(await browserAgent(e2e.httpServer), {
        token,
        confirm,
      });
      const afterwards = await open(browser, { token });

      expect(refused.status).toBe(400);
      expect((afterwards.body as VerifyBody).data.user?.email).toBe(
        SEED_USER.email,
      );
    },
  );
});

/** A browser proof works once, so a browser fetches one before each anonymous post. */
async function proofFor(browser: TestAgent, origin?: string): Promise<string> {
  const request = browser.get('/api/auth/browser-proof');
  if (origin) request.set('Origin', origin);
  const proof = await request.expect(200);
  return (proof.body as { data: { token: string } }).data.token;
}
