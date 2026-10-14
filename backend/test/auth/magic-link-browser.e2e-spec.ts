import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { ConfigService } from '@nestjs/config';
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
    e2e = await bootE2eApp();
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
  ): Promise<{ token: string; cookies: string[] }> {
    const answer = await browser
      .post('/api/auth/magic-link/request')
      .send({ email })
      .expect(200);
    const link = (await e2e.captureMail())
      .at(-1)
      ?.text?.match(/https?:\/\/[^\s]+/)?.[0];
    const token = link ? new URL(link).searchParams.get('token') : null;
    if (!token) throw new Error('Magic link mail has no token');
    return { token, cookies: answer.get('Set-Cookie') ?? [] };
  }

  /** Opens a link from a signed-out browser, with a proof of its own. */
  const open = async (browser: TestAgent, body: Record<string, unknown>) => {
    const proof = await proofFor(browser);
    return browser
      .post('/api/auth/magic-link/verify')
      .set(CSRF_HEADER, proof)
      .send(body);
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
async function proofFor(browser: TestAgent): Promise<string> {
  const proof = await browser.get('/api/auth/browser-proof').expect(200);
  return (proof.body as { data: { token: string } }).data.token;
}
