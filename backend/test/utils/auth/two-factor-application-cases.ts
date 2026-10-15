// feature:totp:start
// feature:email-password:start
import { twoFactorAudienceCases } from './two-factor-audience-cases';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import request, { type Response } from 'supertest';
import { SessionCookieService } from '../../../src/auth/services/sessions/session-cookie.service';
import { Sessions } from '../../../src/auth/services/sessions/sessions';
import {
  TWO_FACTOR_CHALLENGE_COOKIE,
  TWO_FACTOR_CHALLENGE_TTL_MS,
} from '../../../src/auth/two-factor/constants/two-factor.constants';
import { TotpSecretCryptoService } from '../../../src/auth/two-factor/services/totp-secret-crypto.service';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { BrowserPolicyReconciler } from '../../../src/session/applications/browser-policy-reconciler';
import type { BrowserApplicationId } from '../../../src/session/applications/types/browser-application';
import { CSRF_HEADER } from '../../../src/session/constants/browser-proof';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../src/session/constants/client-ids';
import { SEED_USER } from '../../constants/seed-users';
import { E2E_CLIENT_URL, type E2eApp } from '../e2e-app';
import type { Enrolment } from './two-factor-enrolment';

const ADMIN_ORIGIN = 'http://127.0.0.1:3108';

type Enrolled = () => Promise<Enrolment>;

function origin(clientId: BrowserApplicationId): string {
  return clientId === ADMIN_CLIENT_ID ? ADMIN_ORIGIN : E2E_CLIENT_URL;
}

function challengeName(clientId: BrowserApplicationId): string {
  return clientId === ADMIN_CLIENT_ID
    ? `${TWO_FACTOR_CHALLENGE_COOKIE}-${ADMIN_CLIENT_ID}`
    : TWO_FACTOR_CHALLENGE_COOKIE;
}

function cookieFrom(response: Response, name?: string): string {
  const header: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(header)
    ? header.map(String).map((value) => value.split(';')[0])
    : [];
  const cookie = name
    ? cookies.find((value) => value.startsWith(`${name}=`))
    : cookies[0];
  if (!cookie) throw new Error('Expected response cookie was not issued');
  return cookie;
}

async function proof(e2e: E2eApp, clientId: BrowserApplicationId) {
  const response = await request(e2e.httpServer)
    .get('/api/auth/browser-proof')
    .set('Origin', origin(clientId))
    .expect(200);
  return {
    token: (response.body as { data: { token: string } }).data.token,
    cookie: cookieFrom(response),
  };
}

async function firstFactor(e2e: E2eApp, clientId: BrowserApplicationId) {
  const fresh = await proof(e2e, clientId);
  const response = await request(e2e.httpServer)
    .post('/api/auth/login')
    .set('Origin', origin(clientId))
    .set('Cookie', fresh.cookie)
    .set(CSRF_HEADER, fresh.token)
    .send(SEED_USER)
    .expect(200);
  expect(response.body).toMatchObject({ data: { requiresTwoFactor: true } });
  return cookieFrom(response, challengeName(clientId));
}

async function secondFactor(
  e2e: E2eApp,
  clientId: BrowserApplicationId,
  challenge: string,
  recoveryCode: string,
): Promise<Response> {
  const fresh = await proof(e2e, clientId);
  return request(e2e.httpServer)
    .post('/api/auth/2fa/verify')
    .set('Origin', origin(clientId))
    .set('Cookie', [fresh.cookie, challenge])
    .set(CSRF_HEADER, fresh.token)
    .send({ recoveryCode });
}

function renamed(challenge: string, clientId: BrowserApplicationId): string {
  return `${challengeName(clientId)}=${challenge.slice(challenge.indexOf('=') + 1)}`;
}

function legacyChallenge(e2e: E2eApp, challenge: string): string {
  const value = decodeURIComponent(challenge.slice(challenge.indexOf('=') + 1));
  const encoded = value.slice(0, value.lastIndexOf('.'));
  const payload: unknown = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  );
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Expected a signed challenge object');
  }
  Reflect.deleteProperty(payload, 'clientId');
  const legacy = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = e2e.app
    .get(TotpSecretCryptoService, { strict: false })
    .challengeKey();
  const signature = createHmac('sha256', key)
    .update(legacy)
    .digest('base64url');
  return `${challengeName(WEB_CLIENT_ID)}=${legacy}.${signature}`;
}

async function expectSignedIn(
  e2e: E2eApp,
  clientId: BrowserApplicationId,
  response: Response,
): Promise<void> {
  expect(response.status).toBe(200);
  const name = e2e.app
    .get(SessionCookieService, { strict: false })
    .nameFor(clientId);
  const cookie = cookieFrom(response, name);
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  const stored = await e2e.app
    .get(Sessions, { strict: false })
    .validateSessionWithoutExtendingIdle(token);
  expect(stored).toMatchObject({
    clientId,
    authenticationMethods: ['password', 'recovery_code'],
    userVerified: false,
    policyVersion: 0,
    user: { email: SEED_USER.email },
  });
  await request(e2e.httpServer)
    .get('/api/user/profile')
    .set('Origin', origin(clientId))
    .set('Cookie', cookie)
    .expect(200);
}

export function twoFactorApplicationCases(
  current: () => E2eApp,
  enrolled: Enrolled,
): void {
  twoFactorAudienceCases(current, enrolled);
  describe('application-bound second-factor challenges', () => {
    let previousAdminUrl: string | undefined;

    beforeEach(async () => {
      const e2e = current();
      const config = e2e.app.get(ConfigService);
      previousAdminUrl = config.get<string>('cors.adminUrl');
      config.set('cors.adminUrl', ADMIN_ORIGIN);
      await e2e.app.get(BrowserPolicyReconciler).reconcile();
    });

    afterEach(() => {
      current().app.get(ConfigService).set('cors.adminUrl', previousAdminUrl);
    });

    // Failure: renaming a signed challenge cookie admits its first factor to another application.
    it.each([
      [WEB_CLIENT_ID, ADMIN_CLIENT_ID],
      [ADMIN_CLIENT_ID, WEB_CLIENT_ID],
    ] as const)(
      'refuses %s challenge replay in %s before spending it',
      async (source, target) => {
        const e2e = current();
        const { recoveryCodes } = await enrolled();
        const challenge = await firstFactor(e2e, source);
        const before = await e2e.state.sessions.countSessions();
        const refused = await secondFactor(
          e2e,
          target,
          renamed(challenge, target),
          recoveryCodes[0],
        );
        expect(refused.status).toBe(401);
        expect(refused.body).toMatchObject({
          error: { code: ErrorCode.TWO_FACTOR_CHALLENGE_INVALID },
        });
        expect(await e2e.state.sessions.countSessions()).toBe(before);
        await expectSignedIn(
          e2e,
          source,
          await secondFactor(e2e, source, challenge, recoveryCodes[0]),
        );
      },
    );

    // Failure: a pre-deployment unbound challenge becomes an admin credential or stops working for web.
    it('accepts a legacy challenge only for web without consuming an admin replay', async () => {
      const e2e = current();
      const { recoveryCodes } = await enrolled();
      const legacy = legacyChallenge(
        e2e,
        await firstFactor(e2e, WEB_CLIENT_ID),
      );
      const before = await e2e.state.sessions.countSessions();
      const refused = await secondFactor(
        e2e,
        ADMIN_CLIENT_ID,
        renamed(legacy, ADMIN_CLIENT_ID),
        recoveryCodes[0],
      );
      expect(refused.status).toBe(401);
      expect(refused.body).toMatchObject({
        error: { code: ErrorCode.TWO_FACTOR_CHALLENGE_INVALID },
      });
      expect(await e2e.state.sessions.countSessions()).toBe(before);
      await expectSignedIn(
        e2e,
        WEB_CLIENT_ID,
        await secondFactor(e2e, WEB_CLIENT_ID, legacy, recoveryCodes[0]),
      );
      const expired = legacyChallenge(
        e2e,
        await firstFactor(e2e, WEB_CLIENT_ID),
      );
      jest.setSystemTime(new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS));
      const expiredAnswer = await secondFactor(
        e2e,
        WEB_CLIENT_ID,
        expired,
        recoveryCodes[1],
      );
      expect(expiredAnswer.status).toBe(401);
      expect(expiredAnswer.body.error.code).toBe(
        ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
      );
    });
  });
}
// feature:email-password:end
// feature:totp:end
