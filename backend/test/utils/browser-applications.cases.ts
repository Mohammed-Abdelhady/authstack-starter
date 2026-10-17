// feature:email-password:start
import { SESSION_COOKIE_DEFAULT_NAME } from '../../src/config/utils/production-environment.util';
import {
  WEB_CLIENT_ID,
  ADMIN_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import request from 'supertest';
import { storedBrowserSession } from './session/stored-browser-session';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import {
  CSRF_HEADER,
  BROWSER_PROOF_COOKIE,
} from '../../src/session/constants/browser-proof';
import { UserProfileService } from '../../src/user/services/user-profile.service';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, type E2eApp } from './e2e-app';
import {
  ADMIN_ORIGIN,
  WEB_ORIGIN,
  EVIL_ORIGIN,
  configureBrowserApplications,
  cookiePair,
  csrfOf,
  identityEmail,
  proofAt,
  responseCookies,
  signInAt,
} from './browser-applications.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from './hook-timeouts';
import { TEST_NOW } from './frozen-clock';

const ADMIN_SESSION_COOKIE = `${SESSION_COOKIE_DEFAULT_NAME}-${ADMIN_CLIENT_ID}`;
const ADMIN_PROOF_COOKIE = `${BROWSER_PROOF_COOKIE}-${ADMIN_CLIENT_ID}`;

export function browserApplicationCases(): void {
  describe('browser application authority over HTTP', () => {
    let e2e: E2eApp;

    beforeAll(async () => {
      e2e = await bootE2eApp(0, {
        beforeStart: configureBrowserApplications,
      });
    }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await e2e?.close();
    }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

    beforeEach(async () => {
      e2e.clock.set(TEST_NOW);
      await e2e.reset();
    });

    it('selects the account and CSRF token by Origin, and signs out only that application', async () => {
      const browser = request.agent(e2e.httpServer);
      const web = await signInAt(browser, SEED_USER, WEB_ORIGIN);
      const admin = await signInAt(browser, SEED_ADMIN, ADMIN_ORIGIN);
      const webCookie = cookiePair(web, SESSION_COOKIE_DEFAULT_NAME);
      const adminCookie = cookiePair(admin, ADMIN_SESSION_COOKIE);
      const cookies = `${webCookie}; ${adminCookie}`;
      for (const [cookie, clientId] of [
        [webCookie, WEB_CLIENT_ID],
        [adminCookie, ADMIN_CLIENT_ID],
      ]) {
        expect(await storedBrowserSession(e2e.app, cookie)).toMatchObject({
          clientId,
          authenticationMethods: ['password'],
          userVerified: false,
          policyVersion: 0,
        });
      }
      const webCsrf = csrfOf(web);
      const adminCsrf = csrfOf(admin);

      expect(webCsrf).not.toBe(adminCsrf);
      expect(await identityEmail(e2e, cookies, WEB_ORIGIN)).toBe(
        SEED_USER.email,
      );
      expect(await identityEmail(e2e, cookies, ADMIN_ORIGIN)).toBe(
        SEED_ADMIN.email,
      );
      for (const [origin, token] of [
        [WEB_ORIGIN, webCsrf],
        [ADMIN_ORIGIN, adminCsrf],
      ]) {
        const read = await browser
          .get('/api/auth/csrf')
          .set('Origin', origin)
          .expect(200);
        expect(csrfOf(read)).toBe(token);
        expect(read.headers['access-control-allow-origin']).toBe(origin);
        expect(read.headers['access-control-allow-credentials']).toBe('true');
      }

      for (const [origin, wrongToken] of [
        [ADMIN_ORIGIN, webCsrf],
        [WEB_ORIGIN, adminCsrf],
      ]) {
        const refused = await browser
          .post('/api/auth/logout')
          .set('Origin', origin)
          .set(CSRF_HEADER, wrongToken)
          .expect(403);
        expect(refused.body.error.code).toBe(ErrorCode.CSRF_INVALID);
      }
      expect(await identityEmail(e2e, cookies, WEB_ORIGIN)).toBe(
        SEED_USER.email,
      );
      expect(await identityEmail(e2e, cookies, ADMIN_ORIGIN)).toBe(
        SEED_ADMIN.email,
      );

      const signedOut = await browser
        .post('/api/auth/logout')
        .set('Origin', ADMIN_ORIGIN)
        .set(CSRF_HEADER, adminCsrf)
        .expect(200);
      const cleared = responseCookies(signedOut);
      expect(
        cleared.some((cookie) =>
          cookie.startsWith(`${ADMIN_SESSION_COOKIE}=;`),
        ),
      ).toBe(true);
      expect(
        cleared.some((cookie) =>
          cookie.startsWith(`${SESSION_COOKIE_DEFAULT_NAME}=;`),
        ),
      ).toBe(false);
      // The original cookie also loses authority, independently of jar clearing.
      expect(await identityEmail(e2e, cookies, ADMIN_ORIGIN)).toBeNull();
      expect(await identityEmail(e2e, cookies, WEB_ORIGIN)).toBe(
        SEED_USER.email,
      );
    });

    it('ignores the other application cookie, including with no Origin and an admin Referer', async () => {
      const browser = request.agent(e2e.httpServer);
      const web = await signInAt(browser, SEED_USER, WEB_ORIGIN);
      const admin = await signInAt(browser, SEED_ADMIN, ADMIN_ORIGIN);
      const webCookie = cookiePair(web, SESSION_COOKIE_DEFAULT_NAME);
      const adminCookie = cookiePair(admin, ADMIN_SESSION_COOKIE);

      expect(await identityEmail(e2e, adminCookie, WEB_ORIGIN)).toBeNull();
      expect(await identityEmail(e2e, webCookie, ADMIN_ORIGIN)).toBeNull();
      expect(
        await identityEmail(
          e2e,
          adminCookie,
          undefined,
          `${ADMIN_ORIGIN}/account`,
        ),
      ).toBeNull();
      expect(
        await identityEmail(
          e2e,
          `${webCookie}; ${adminCookie}`,
          undefined,
          `${ADMIN_ORIGIN}/account`,
        ),
      ).toBe(SEED_USER.email);
      await request(e2e.httpServer)
        .get('/api/user/profile')
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', adminCookie)
        .expect(401);
      await request(e2e.httpServer)
        .get('/api/user/profile')
        .set('Origin', ADMIN_ORIGIN)
        .set('Cookie', webCookie)
        .expect(401);
    });

    it('issues web authority without Origin and never promotes an admin Referer', async () => {
      const browser = request.agent(e2e.httpServer);
      const signedIn = await signInAt(browser, SEED_USER);
      const cookie = cookiePair(signedIn, SESSION_COOKIE_DEFAULT_NAME);
      expect(
        responseCookies(signedIn).some((value) =>
          value.startsWith(`${ADMIN_SESSION_COOKIE}=`),
        ),
      ).toBe(false);
      expect(await identityEmail(e2e, cookie)).toBe(SEED_USER.email);
      expect(await identityEmail(e2e, cookie, ADMIN_ORIGIN)).toBeNull();

      const anonymous = request.agent(e2e.httpServer);
      const proof = await proofAt(anonymous);
      const refused = await anonymous
        .post('/api/auth/login')
        .set('Referer', `${ADMIN_ORIGIN}/sign-in`)
        .set(CSRF_HEADER, proof)
        .send(SEED_ADMIN)
        .expect(403);
      expect(refused.body.error.code).toBe(ErrorCode.ORIGIN_REJECTED);
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    });

    it('keeps pending web and admin login proofs independent in one cookie jar', async () => {
      const browser = request.agent(e2e.httpServer);
      const webProof = await browser
        .get('/api/auth/browser-proof')
        .set('Origin', WEB_ORIGIN)
        .expect(200);
      const adminProof = await browser
        .get('/api/auth/browser-proof')
        .set('Origin', ADMIN_ORIGIN)
        .expect(200);
      expect(cookiePair(webProof, BROWSER_PROOF_COOKIE)).toMatch(
        new RegExp(`^${BROWSER_PROOF_COOKIE}=.+`, 'u'),
      );
      expect(cookiePair(adminProof, ADMIN_PROOF_COOKIE)).toMatch(
        new RegExp(`^${ADMIN_PROOF_COOKIE}=.+`, 'u'),
      );
      const web = await browser
        .post('/api/auth/login')
        .set('Origin', WEB_ORIGIN)
        .set(CSRF_HEADER, csrfOf(webProof))
        .send(SEED_USER)
        .expect(200);
      const admin = await browser
        .post('/api/auth/login')
        .set('Origin', ADMIN_ORIGIN)
        .set(CSRF_HEADER, csrfOf(adminProof))
        .send(SEED_ADMIN)
        .expect(200);
      expect(
        await identityEmail(
          e2e,
          cookiePair(web, SESSION_COOKIE_DEFAULT_NAME),
          WEB_ORIGIN,
        ),
      ).toBe(SEED_USER.email);
      expect(
        await identityEmail(
          e2e,
          cookiePair(admin, ADMIN_SESSION_COOKIE),
          ADMIN_ORIGIN,
        ),
      ).toBe(SEED_ADMIN.email);
    });

    it('refuses an admin credential renamed as the web cookie', async () => {
      const browser = request.agent(e2e.httpServer);
      const signedIn = await signInAt(browser, SEED_ADMIN, ADMIN_ORIGIN);
      const original = cookiePair(signedIn, ADMIN_SESSION_COOKIE);
      const renamed = `${SESSION_COOKIE_DEFAULT_NAME}=${original.slice(
        `${ADMIN_SESSION_COOKIE}=`.length,
      )}`;
      expect(await identityEmail(e2e, renamed, WEB_ORIGIN)).toBeNull();
      const refused = await request(e2e.httpServer)
        .get('/api/user/profile')
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', renamed)
        .expect(401);
      expect(refused.body.error.code).toBe(ErrorCode.SESSION_INVALID);
      expect(await identityEmail(e2e, original, ADMIN_ORIGIN)).toBe(
        SEED_ADMIN.email,
      );
    });

    it('rejects signed-in GET requests from an unlisted same-site Origin before reading a profile', async () => {
      const browser = request.agent(e2e.httpServer);
      await signInAt(browser, SEED_USER, WEB_ORIGIN);
      const profiles = e2e.app.get(UserProfileService, { strict: false });
      const read = jest.spyOn(profiles, 'getProfile');
      try {
        for (const path of ['/api/user/profile', '/api/auth/identity']) {
          const refused = await browser
            .get(path)
            .set('Origin', EVIL_ORIGIN)
            .set('Sec-Fetch-Site', 'same-site')
            .expect(403);
          expect(refused.body.error.code).toBe(ErrorCode.ORIGIN_REJECTED);
          expect(
            refused.headers['access-control-allow-origin'],
          ).toBeUndefined();
        }
        expect(read).not.toHaveBeenCalled();
        await browser
          .get('/api/user/profile')
          .set('Origin', WEB_ORIGIN)
          .expect(200);
        expect(read).toHaveBeenCalledTimes(1);
      } finally {
        read.mockRestore();
      }
    });
  });
}
// feature:email-password:end
