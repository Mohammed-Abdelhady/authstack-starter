// feature:email-password:start
import { SESSION_COOKIE_DEFAULT_NAME } from '../../../src/config/utils/production-environment.util';
import {
  WEB_CLIENT_ID,
  ADMIN_CLIENT_ID,
} from '../../../src/session/constants/client-ids';
import { storedBrowserSession } from '../session/stored-browser-session';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import request, { type Response } from 'supertest';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { CSRF_HEADER } from '../../../src/session/constants/browser-proof';
import { proofAt } from '../browser-applications.fixtures';
import { bootE2eApp, type E2eApp, type TestAgent } from '../e2e-app';
import { TEST_NOW } from '../frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../hook-timeouts';

const ADMIN_SESSION_COOKIE = `${SESSION_COOKIE_DEFAULT_NAME}-${ADMIN_CLIENT_ID}`;

const ADMIN_ORIGIN = 'http://admin.example.test';
const WEB_ORIGIN = 'http://127.0.0.1:3107';
const EMAIL = 'bound-activation@example.test';
const CODE = '123456';
const ACCOUNT = { email: EMAIL, password: 'Password123!', name: 'New account' };

export function activationApplicationCases(): void {
  describe('activation application binding', () => {
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
    });

    async function post(
      browser: TestAgent,
      path: string,
      origin: string,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const proof = await proofAt(browser, origin);
      return browser
        .post(`/api/auth/${path}`)
        .set('Origin', origin)
        .set(CSRF_HEADER, proof)
        .send(body);
    }

    // Failure: a signup code for one application creates a session in the other.
    it.each([
      [WEB_CLIENT_ID, WEB_ORIGIN, ADMIN_ORIGIN, SESSION_COOKIE_DEFAULT_NAME],
      [ADMIN_CLIENT_ID, ADMIN_ORIGIN, WEB_ORIGIN, ADMIN_SESSION_COOKIE],
    ])(
      'binds a %s registration through issuance and activation',
      async (_clientId, origin, otherOrigin, cookieName) => {
        const browser = request.agent(e2e.httpServer);
        expect(
          (await post(browser, 'register', origin, { email: EMAIL })).status,
        ).toBe(200);
        if (_clientId === ADMIN_CLIENT_ID) {
          expect(
            (await post(browser, 'resend-activation', origin, { email: EMAIL }))
              .status,
          ).toBe(200);
        }
        const code = await e2e.mailedCode();
        const crossed = await post(browser, 'activate', otherOrigin, {
          ...ACCOUNT,
          code,
        });
        expect(crossed.status).toBe(400);
        expect(crossed.body.error.code).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
        expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(0);
        expect(await e2e.state.sessions.countSessions()).toBe(0);
        const completed = await post(browser, 'activate', origin, {
          ...ACCOUNT,
          code,
        });
        expect(completed.status).toBe(200);
        expect(completed.body).toMatchObject({
          data: { user: { email: EMAIL } },
        });
        const cookies: unknown = completed.headers['set-cookie'];
        expect(
          Array.isArray(cookies) &&
            cookies.some((cookie: string) =>
              cookie.startsWith(`${cookieName}=`),
            ),
        ).toBe(true);
        const sessionCookie = Array.isArray(cookies)
          ? cookies
              .map(String)
              .find((cookie) => cookie.startsWith(`${cookieName}=`))
          : undefined;
        if (!sessionCookie) {
          throw new Error('Activation did not issue its session');
        }
        expect(
          await storedBrowserSession(e2e.app, sessionCookie.split(';')[0]),
        ).toMatchObject({
          clientId: _clientId,
          authenticationMethods: ['email_code'],
          userVerified: false,
          policyVersion: 0,
        });
        expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
      },
    );

    // Failure: an activation already mailed before deployment gains admin authority.
    it('keeps a legacy code web-only and does not consume it on admin refusal', async () => {
      await e2e.state.auth.storePendingRegistration({
        email: EMAIL,
        purpose: 'signup',
        hashedCode: await bcrypt.hash(CODE, 4),
        attempts: 0,
        expiresAt: new Date(TEST_NOW.getTime() + 900_000),
      });
      const browser = request.agent(e2e.httpServer);
      const refused = await post(browser, 'activate', ADMIN_ORIGIN, {
        ...ACCOUNT,
        code: CODE,
      });
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
      const completed = await post(browser, 'activate', WEB_ORIGIN, {
        ...ACCOUNT,
        code: CODE,
      });
      expect(completed.status).toBe(200);
      expect(completed.body).toMatchObject({
        data: { user: { email: EMAIL } },
      });
    });
  });
}
// feature:email-password:end
