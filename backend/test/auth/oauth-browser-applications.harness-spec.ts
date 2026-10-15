// feature:oauth-core:start
import { OAUTH_STATE_COOKIE_PREFIX } from '../../src/auth/oauth/oauth.constants';
import { SESSION_COOKIE_DEFAULT_NAME } from '../../src/config/utils/production-environment.util';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import { ConfigService } from '@nestjs/config';
import request, { type Response } from 'supertest';
import type {
  OAuthCallbackMethod,
  OAuthProviderStrategy,
} from '../../src/auth/oauth/oauth-provider.interface';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  E2E_CLIENT_URL,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { storedBrowserSession } from '../utils/session/stored-browser-session';
import { TEST_NOW } from '../utils/frozen-clock';

const ADMIN_SESSION_COOKIE = `${SESSION_COOKIE_DEFAULT_NAME}-${ADMIN_CLIENT_ID}`;

const ADMIN_ORIGIN = 'http://admin.example.test';
const RETURN_PATH = '/en/dashboard';
const CALLBACK_METHODS: readonly OAuthCallbackMethod[] = ['GET', 'POST'];

interface StartedOAuth {
  state: string;
  cookie: string;
}

function writtenCookies(response: Response): string[] {
  const header: unknown = response.headers['set-cookie'];
  return Array.isArray(header) ? header.map(String) : [];
}

function cookiePair(response: Response, name: string): string {
  const written = writtenCookies(response).find((cookie) =>
    cookie.startsWith(`${name}=`),
  );
  if (!written) throw new Error(`Response omitted cookie ${name}`);
  return written.split(';')[0];
}

export function describeBrowserOAuthApplications(
  strategy: OAuthProviderStrategy,
  offeredState: () => string,
): void {
  describe.each(CALLBACK_METHODS)(
    'browser OAuth applications, %s callback (e2e)',
    (method) => {
      let e2e: E2eApp;
      const providerId = method === 'POST' ? 'apple' : 'google';
      const startPath = `/api/auth/oauth/${providerId}/start`;
      const callbackPath = `/api/auth/oauth/${providerId}/callback`;
      const webStateName = `${OAUTH_STATE_COOKIE_PREFIX}${WEB_CLIENT_ID}_${providerId}`;
      const adminStateName = `${OAUTH_STATE_COOKIE_PREFIX}${ADMIN_CLIENT_ID}_${providerId}`;

      beforeAll(async () => {
        e2e = await bootE2eApp(0, {
          browserStrategy: {
            ...strategy,
            id: providerId,
            callbackMethod: method,
          },
          beforeStart: (app) => {
            app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN);
            app.get(ConfigService).set('auth.admin.signIn', {
              password: false,
            });
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

      async function start(
        browser: TestAgent,
        origin: string,
        cookieName: string,
      ): Promise<StartedOAuth> {
        const proof = await browser
          .get('/api/auth/browser-proof')
          .set('Origin', origin)
          .expect(200);
        const token = (proof.body as { data: { token: string } }).data.token;
        const started = await browser
          .post(startPath)
          .query({ redirect: RETURN_PATH })
          .set('Origin', origin)
          .set(CSRF_HEADER, token)
          .send({})
          .expect(201);
        expect(started.body).toMatchObject({
          data: { url: 'https://provider.example/authorize' },
        });
        return {
          state: offeredState(),
          cookie: cookiePair(started, cookieName),
        };
      }

      async function callback(
        ceremony: StartedOAuth,
        cookies: string[],
        state = ceremony.state,
      ): Promise<Response> {
        const params = { state, code: 'provider-code' };
        // Only state cookies cross the provider boundary; Origin is absent.
        if (method === 'POST') {
          return request(e2e.httpServer)
            .post(callbackPath)
            .set('Cookie', cookies.join('; '))
            .type('form')
            .send(params)
            .redirects(0);
        }
        return request(e2e.httpServer)
          .get(callbackPath)
          .set('Cookie', cookies.join('; '))
          .query(params)
          .redirects(0);
      }

      async function assertIdentity(
        cookie: string,
        origin: string,
        authenticated: boolean,
      ): Promise<void> {
        const identity = await request(e2e.httpServer)
          .get('/api/auth/identity')
          .set('Origin', origin)
          .set('Cookie', cookie)
          .expect(200);
        expect(identity.body).toMatchObject({
          data: authenticated
            ? { authenticated: true, user: { email: SEED_USER.email } }
            : { authenticated: false, user: null },
        });
      }

      // Catches web/admin state overwrites, callback fallback to web, or clearing the other ceremony.
      it('finishes both applications independently from one browser without callback Origin', async () => {
        const browser = request.agent(e2e.httpServer);
        for (const origin of [E2E_CLIENT_URL, ADMIN_ORIGIN]) {
          const methods = await browser
            .get('/api/auth/methods')
            .set('Origin', origin)
            .expect(200);
          expect(methods.body).toMatchObject({
            data: { methods: { oauth: [{ id: providerId }] } },
          });
        }
        const web = await start(browser, E2E_CLIENT_URL, webStateName);
        const admin = await start(browser, ADMIN_ORIGIN, adminStateName);
        expect(admin.state).not.toBe(web.state);
        const bothCookies = [web.cookie, admin.cookie];

        const adminReturned = await callback(admin, bothCookies);
        const adminLocation = new URL(String(adminReturned.headers.location));
        expect({
          status: adminReturned.status,
          origin: adminLocation.origin,
          result: adminLocation.searchParams.get('status'),
          redirect: adminLocation.searchParams.get('redirect'),
        }).toEqual({
          status: 302,
          origin: ADMIN_ORIGIN,
          result: 'ok',
          redirect: RETURN_PATH,
        });
        const adminHeaders = writtenCookies(adminReturned);
        expect(
          adminHeaders.some((cookie) =>
            cookie.startsWith(`${adminStateName}=;`),
          ),
        ).toBe(true);
        expect(
          adminHeaders.some((cookie) => cookie.startsWith(`${webStateName}=`)),
        ).toBe(false);
        const adminSession = cookiePair(adminReturned, ADMIN_SESSION_COOKIE);
        expect(await storedBrowserSession(e2e.app, adminSession)).toMatchObject(
          {
            clientId: ADMIN_CLIENT_ID,
            authenticationMethods: ['provider'],
            userVerified: false,
            policyVersion: 1,
          },
        );
        await assertIdentity(adminSession, ADMIN_ORIGIN, true);
        await assertIdentity(adminSession, E2E_CLIENT_URL, false);

        const webReturned = await callback(web, [web.cookie]);
        const webLocation = new URL(String(webReturned.headers.location));
        expect({
          status: webReturned.status,
          origin: webLocation.origin,
          result: webLocation.searchParams.get('status'),
        }).toEqual({ status: 302, origin: E2E_CLIENT_URL, result: 'ok' });
        const webHeaders = writtenCookies(webReturned);
        expect(
          webHeaders.some((cookie) => cookie.startsWith(`${webStateName}=;`)),
        ).toBe(true);
        expect(
          webHeaders.some((cookie) => cookie.startsWith(`${adminStateName}=`)),
        ).toBe(false);
        const webSession = cookiePair(webReturned, SESSION_COOKIE_DEFAULT_NAME);
        await assertIdentity(webSession, E2E_CLIENT_URL, true);
        await assertIdentity(webSession, ADMIN_ORIGIN, false);
        expect(await e2e.state.sessions.countSessions()).toBe(2);
      });

      // Catches using an unsigned application hint or deleting a separate valid ceremony on failure.
      it('refuses unmatched state without issuing a session or clearing either ceremony', async () => {
        const browser = request.agent(e2e.httpServer);
        const web = await start(browser, E2E_CLIENT_URL, webStateName);
        const admin = await start(browser, ADMIN_ORIGIN, adminStateName);
        const returned = await callback(
          admin,
          [web.cookie, admin.cookie],
          `tampered-${admin.state}`,
        );
        const location = new URL(String(returned.headers.location));
        expect(location.searchParams.get('code')).toBe(
          ErrorCode.OAUTH_STATE_INVALID,
        );
        expect(writtenCookies(returned)).toEqual([]);
        expect(await e2e.state.sessions.countSessions()).toBe(0);
        const valid = await callback(admin, [web.cookie, admin.cookie]);
        expect(
          new URL(String(valid.headers.location)).searchParams.get('status'),
        ).toBe('ok');
      });

      // Catches a retained navigation route adopting admin solely from Origin.
      it('keeps the navigation start bound to web even from the admin origin', async () => {
        const started = await request(e2e.httpServer)
          .get(startPath)
          .set('Origin', ADMIN_ORIGIN)
          .query({ redirect: RETURN_PATH })
          .redirects(0)
          .expect(302);
        expect(cookiePair(started, webStateName)).toMatch(
          new RegExp(`^${webStateName}=`),
        );
        expect(
          writtenCookies(started).some((cookie) =>
            cookie.startsWith(`${adminStateName}=`),
          ),
        ).toBe(false);
      });
    },
  );
}
// feature:oauth-core:end
