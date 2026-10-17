// feature:totp:start
// feature:email-password:start
import { SessionCookieService } from '../../../src/auth/services/sessions/session-cookie.service';
import type { Response } from 'supertest';
import { WEB_CLIENT_ID } from '../../../src/session/constants/client-ids';
import type { E2eApp } from '../e2e-app';
import { storedBrowserSession } from '../session/stored-browser-session';

export function cookieNames(response: Response): string[] {
  const header: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header.map(String) : [];
  return cookies
    .filter((cookie) => !/^[^=]+=;/.test(cookie))
    .map((cookie) => cookie.split('=')[0]);
}

/** Failure: the real issuer drops a successfully verified second factor. */
export async function expectSecondFactorEvidence(
  e2e: E2eApp,
  response: Response,
  secondFactor: 'totp' | 'recovery_code',
): Promise<void> {
  const name = e2e.app
    .get(SessionCookieService, { strict: false })
    .nameFor(WEB_CLIENT_ID);
  const cookies: unknown = response.headers['set-cookie'];
  const cookie = Array.isArray(cookies)
    ? cookies.map(String).find((value) => value.startsWith(`${name}=`))
    : undefined;
  if (!cookie) throw new Error('Expected the issued web session');
  expect(
    await storedBrowserSession(e2e.app, cookie.split(';')[0]),
  ).toMatchObject({
    clientId: WEB_CLIENT_ID,
    authenticationMethods: ['password', secondFactor],
    userVerified: false,
    policyVersion: 0,
  });
}
// feature:email-password:end
// feature:totp:end
