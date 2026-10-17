import { applicationCookieName } from '../../../src/session/utils/request/application-cookie-name'; // feature:totp
import request, { type Response } from 'supertest';
import { SessionCookieService } from '../../../src/auth/services/sessions/session-cookie.service';
import { REQUEST_ID_HEADER } from '../../../src/common/constants/request-id';
import { CSRF_HEADER } from '../../../src/session/constants/browser-proof';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../src/session/constants/client-ids';
import { TWO_FACTOR_CHALLENGE_COOKIE } from '../../../src/auth/two-factor/constants/two-factor.constants'; // feature:totp
import { ADMIN_ORIGIN } from '../audience-authorization.fixtures';
import type { E2eApp, TestAgent } from '../e2e-app';

const REQUEST_ID = 'audience-refusal-case';

export async function anonymousPost(
  e2e: E2eApp,
  path: string,
  body: object,
  browser: TestAgent = request.agent(e2e.httpServer),
  origin = ADMIN_ORIGIN,
): Promise<Response> {
  const proof = await browser
    .get('/api/auth/browser-proof')
    .set('Origin', origin)
    .expect(200);
  return browser
    .post(path)
    .set('Origin', origin)
    .set(REQUEST_ID_HEADER, REQUEST_ID)
    .set(CSRF_HEADER, (proof.body as { data: { token: string } }).data.token)
    .send(body);
}

export function reply(response: Response) {
  return { status: response.status, body: response.body as unknown };
}

/** Only the caller's own address echo is normalized for enumeration checks. */
export function addressReply(response: Response) {
  const body = response.body as {
    success: boolean;
    data: Record<string, unknown>;
    message?: string;
  };
  return {
    status: response.status,
    body: { ...body, data: { ...body.data, email: 'submitted-address' } },
  };
}

export function expectNoAuthority(e2e: E2eApp, response: Response): void {
  const names = e2e.app.get(SessionCookieService);
  const forbidden = [
    names.nameFor(WEB_CLIENT_ID),
    names.nameFor(ADMIN_CLIENT_ID),
    TWO_FACTOR_CHALLENGE_COOKIE, // feature:totp
    applicationCookieName(TWO_FACTOR_CHALLENGE_COOKIE, ADMIN_CLIENT_ID), // feature:totp
  ];
  const cookies: unknown = response.headers['set-cookie'];
  const written = Array.isArray(cookies) ? cookies.map(String) : [];
  expect(
    written.filter((cookie) =>
      forbidden.some(
        (name) =>
          cookie.startsWith(`${name}=`) && !cookie.startsWith(`${name}=;`),
      ),
    ),
  ).toEqual([]);
}
