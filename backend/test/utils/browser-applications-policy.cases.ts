// feature:email-password:start
import { SESSION_COOKIE_DEFAULT_NAME } from '../../src/config/utils/production-environment.util';
import { BrowserApplications } from '../../src/session/applications/browser-applications';
import { BrowserPolicyReconciler } from '../../src/session/applications/browser-policy-reconciler';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import { storedBrowserSession } from './session/stored-browser-session';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, type E2eApp } from './e2e-app';
import {
  ADMIN_ORIGIN,
  WEB_ORIGIN,
  configureBrowserApplications,
  cookiePair,
  identityEmail,
  proofAt,
  signInAt,
} from './browser-applications.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from './hook-timeouts';
import { TEST_NOW } from './frozen-clock';

const ADMIN_SESSION_COOKIE = `${SESSION_COOKIE_DEFAULT_NAME}-${ADMIN_CLIENT_ID}`;

export function browserApplicationPolicyCases(): void {
  describe('browser sign-in method availability', () => {
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
      configureBrowserApplications(e2e.app);
      e2e.clock.set(TEST_NOW);
      await e2e.reset();
    });

    it('intersects application and server password switches in discovery and route acceptance', async () => {
      const config = e2e.app.get(ConfigService);
      config.set('auth.admin.signIn', { password: false });
      const browser = request.agent(e2e.httpServer);
      const methods = async (origin: string): Promise<boolean> => {
        const response = await browser
          .get('/api/auth/methods')
          .set('Origin', origin)
          .expect(200);
        return (response.body as { data: { methods: { password: boolean } } })
          .data.methods.password;
      };
      const refusedLogin = async (origin: string): Promise<void> => {
        const anonymous = request.agent(e2e.httpServer);
        const token = await proofAt(anonymous, origin);
        const response = await anonymous
          .post('/api/auth/login')
          .set('Origin', origin)
          .set(CSRF_HEADER, token)
          .set('Authorization', 'Bearer unverified')
          .send(SEED_USER)
          .expect(404);
        expect(response.body.error.code).toBe(ErrorCode.FEATURE_DISABLED);
      };

      expect(await methods(WEB_ORIGIN)).toBe(true);
      expect(await methods(ADMIN_ORIGIN)).toBe(false);
      await refusedLogin(ADMIN_ORIGIN);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      const web = await signInAt(browser, SEED_USER, WEB_ORIGIN);
      expect(
        await identityEmail(
          e2e,
          cookiePair(web, SESSION_COOKIE_DEFAULT_NAME),
          WEB_ORIGIN,
        ),
      ).toBe(SEED_USER.email);

      config.set('auth.admin.signIn', { password: true });
      config.set('auth.passwordEnabled', false);
      expect(await methods(WEB_ORIGIN)).toBe(false);
      expect(await methods(ADMIN_ORIGIN)).toBe(false);
      await refusedLogin(ADMIN_ORIGIN);
      await refusedLogin(WEB_ORIGIN);
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    });

    // Failure: removing a disable setting leaves CORS, guards and session authority inconsistent.
    it('uses stored availability after false, absent and true settings', async () => {
      const config = e2e.app.get(ConfigService);
      const applications = e2e.app.get(BrowserApplications);
      const registry = e2e.app.get(ApplicationRegistry);
      const sessions = e2e.app.get(Sessions);
      const reconciler = e2e.app.get(BrowserPolicyReconciler);
      const browser = request.agent(e2e.httpServer);
      const signedIn = await signInAt(browser, SEED_USER, WEB_ORIGIN);
      const cookie = cookiePair(signedIn, SESSION_COOKIE_DEFAULT_NAME);
      const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
      const stored = await storedBrowserSession(e2e.app, cookie);
      if (!stored) throw new Error('Expected the original stored session');
      const userId = stored.userId;

      async function expectAvailability(enabled: boolean): Promise<void> {
        expect((await registry.findByClientId(WEB_CLIENT_ID))?.enabled).toBe(
          enabled,
        );
        expect((await applications.application(WEB_CLIENT_ID)).enabled).toBe(
          enabled,
        );
        expect((await applications.allowedOrigins()).includes(WEB_ORIGIN)).toBe(
          enabled,
        );
        for (const origin of [WEB_ORIGIN, undefined]) {
          const pending = request(e2e.httpServer).get('/api/auth/methods');
          if (origin) pending.set('Origin', origin);
          const response = await pending.expect(enabled ? 200 : 403);
          if (enabled) {
            expect(response.headers['access-control-allow-origin']).toBe(
              origin,
            );
          } else {
            expect(response.body.error.code).toBe(
              ErrorCode.APPLICATION_DISABLED,
            );
            expect(
              response.headers['access-control-allow-origin'],
            ).toBeUndefined();
          }
        }
        const validated =
          await sessions.validateSessionWithoutExtendingIdle(token);
        expect(Boolean(validated)).toBe(enabled);
        const issue = sessions.createSession(
          userId,
          'availability-case',
          '127.0.0.1',
          WEB_CLIENT_ID,
        );
        if (enabled) {
          await expect(issue).resolves.toHaveProperty('sessionToken');
          const fresh = await signInAt(
            request.agent(e2e.httpServer),
            SEED_USER,
            WEB_ORIGIN,
          );
          expect(cookiePair(fresh, SESSION_COOKIE_DEFAULT_NAME)).toContain(
            `${SESSION_COOKIE_DEFAULT_NAME}=`,
          );
        } else {
          await expect(issue).rejects.toMatchObject({
            code: ErrorCode.APPLICATION_DISABLED,
          });
          await request(e2e.httpServer)
            .post('/api/auth/login')
            .set('Origin', WEB_ORIGIN)
            .send(SEED_USER)
            .expect(403);
        }
      }

      config.set('auth.web.enabledExplicit', true);
      config.set('auth.web.enabled', false);
      await reconciler.reconcile();
      await expectAvailability(false);
      config.set('auth.web.enabledExplicit', false);
      config.set('auth.web.enabled', undefined);
      await reconciler.reconcile();
      await expectAvailability(false);
      config.set('auth.web.enabledExplicit', true);
      config.set('auth.web.enabled', true);
      await reconciler.reconcile();
      await expectAvailability(true);
    });
  });

  describe('a deployment with web disabled and admin configured', () => {
    let e2e: E2eApp;

    beforeAll(async () => {
      e2e = await bootE2eApp(0, {
        beforeStart: (app) => configureBrowserApplications(app, false),
      });
    }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await e2e?.close();
    }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

    beforeEach(async () => {
      e2e.clock.set(TEST_NOW);
      await e2e.reset();
    });

    // Failure: disabling the website also marks the API unhealthy or hides machine metadata.
    it('keeps health and unauthenticated machine metadata available', async () => {
      for (const path of [
        '/health',
        '/api',
        '/api/auth/oauth/providers', // feature:oauth-core
      ]) {
        const response = await request(e2e.httpServer).get(path).expect(200);
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      }
    });

    it('refuses web browser entry points and no-Origin fallback without issuing authority', async () => {
      for (const origin of [undefined, WEB_ORIGIN]) {
        for (const path of [
          '/api/auth/browser-proof',
          '/api/auth/methods',
          '/api/auth/identity',
        ]) {
          const pending = request(e2e.httpServer).get(path);
          if (origin) pending.set('Origin', origin);
          const refused = await pending.expect(403);
          expect(refused.body.error.code).toBe(ErrorCode.APPLICATION_DISABLED);
          expect(refused.headers['set-cookie']).toBeUndefined();
          expect(
            refused.headers['access-control-allow-origin'],
          ).toBeUndefined();
        }
        const pending = request(e2e.httpServer).post('/api/auth/login');
        if (origin) pending.set('Origin', origin);
        const refused = await pending.send(SEED_USER).expect(403);
        expect(refused.body.error.code).toBe(ErrorCode.APPLICATION_DISABLED);
      }
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expect(await e2e.captureMail()).toHaveLength(0);
    });

    it('continues accepting admin login and exposes only the admin Origin', async () => {
      const browser = request.agent(e2e.httpServer);
      const signedIn = await signInAt(browser, SEED_ADMIN, ADMIN_ORIGIN);
      expect(signedIn.headers['access-control-allow-origin']).toBe(
        ADMIN_ORIGIN,
      );
      expect(signedIn.headers['access-control-allow-credentials']).toBe('true');
      expect(
        await identityEmail(
          e2e,
          cookiePair(signedIn, ADMIN_SESSION_COOKIE),
          ADMIN_ORIGIN,
        ),
      ).toBe(SEED_ADMIN.email);
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    });
  });
}
// feature:email-password:end
