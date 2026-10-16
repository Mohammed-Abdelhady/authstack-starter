import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import type { InvitationAcceptance } from '../../src/auth/invitations/types/invitation-acceptance';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { CREDENTIAL_PURPOSE } from '../../src/session/constants/credential-purpose';
import { bootE2eApp, E2E_CLIENT_URL, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { storeBrowserPolicy } from '../utils/session/store-browser-policy';
import { storedBrowserSession } from '../utils/session/stored-browser-session';
import type { ApiBody } from '../types/e2e-responses';
import {
  ACCEPT_ROUTE,
  mailInvitation,
} from './invitation-fixtures.harness-spec';

const ADMIN_ORIGIN = 'http://admin.example.test';

describe('invitation session destinations', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  // The token's application and passkey requirement must govern the persisted session and cookie.
  it.each([
    { clientId: 'admin', requirePasskey: false },
    { clientId: 'admin', requirePasskey: true },
    { clientId: 'web', requirePasskey: true },
  ] as const)(
    'issues a $clientId session with requirePasskey=$requirePasskey',
    async ({ clientId, requirePasskey }) => {
      await storeBrowserPolicy(e2e, clientId, { requirePasskey });
      const { token } = await mailInvitation(e2e, { clientId });
      const browser = request.agent(e2e.httpServer);
      const origin = clientId === 'admin' ? ADMIN_ORIGIN : E2E_CLIENT_URL;
      const proof = await browser
        .get('/api/auth/browser-proof')
        .set('Origin', origin)
        .expect(200);
      const csrf = (proof.body as ApiBody<{ token: string }>).data.token;
      // Omitting Origin makes the token's ceremony reader determine the application.
      const accepted = await browser
        .post(ACCEPT_ROUTE)
        .set(CSRF_HEADER, csrf)
        .send({ token })
        .expect(200);
      expect((accepted.body as InvitationAcceptance).enrolment).toBe(
        requirePasskey,
      );
      const cookieName = e2e.app.get(SessionCookieService).nameFor(clientId);
      const cookie = accepted
        .get('Set-Cookie')
        ?.find((value) => value.startsWith(`${cookieName}=`))
        ?.split(';')[0];
      if (!cookie) throw new Error('Application session cookie missing');
      const session = await storedBrowserSession(e2e.app, cookie);
      expect(session?.clientId).toBe(clientId);
      expect(session?.credentialPurpose).toBe(
        requirePasskey
          ? CREDENTIAL_PURPOSE.ENROLMENT
          : CREDENTIAL_PURPOSE.BROWSER_SESSION,
      );
      expect(session?.authenticationMethods).toEqual([]);
      const identity = await browser
        .get('/api/auth/identity')
        .set('Origin', origin)
        .expect(200);
      expect(
        (identity.body as ApiBody<{ authenticated: boolean }>).data
          .authenticated,
      ).toBe(true);
      if (clientId === 'admin') {
        const web = await browser
          .get('/api/auth/identity')
          .set('Origin', E2E_CLIENT_URL)
          .expect(200);
        expect(
          (web.body as ApiBody<{ authenticated: boolean }>).data.authenticated,
        ).toBe(false);
      }
    },
  );
});
