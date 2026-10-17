import { SESSION_COOKIE_DEFAULT_NAME } from '../../src/config/utils/production-environment.util';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'supertest';
import request from 'supertest';
import { unwrapIdentityBody } from '@app/sdk';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import type { SeedUser } from '../constants/seed-users'; // feature:email-password
import { E2E_CLIENT_URL, type E2eApp, type TestAgent } from './e2e-app';

export const WEB_ORIGIN = E2E_CLIENT_URL;
export const ADMIN_ORIGIN = 'http://127.0.0.1:3108';
export const EVIL_ORIGIN = 'http://127.0.0.1:3109';

export function configureBrowserApplications(
  app: INestApplication,
  webEnabled = true,
): void {
  const config = app.get(ConfigService);
  config.set('cors.clientUrl', WEB_ORIGIN);
  config.set('cors.adminUrl', ADMIN_ORIGIN);
  config.set('session.cookieName', SESSION_COOKIE_DEFAULT_NAME);
  config.set('auth.passwordEnabled', true); // feature:email-password
  config.set('auth.web.enabled', webEnabled);
  config.set('auth.web.enabledExplicit', true);
  config.set('auth.web.signIn', {});
  config.set('auth.admin.signIn', {});
}

export function responseCookies(response: Response): string[] {
  const value: unknown = response.headers['set-cookie'];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((cookie): cookie is string => typeof cookie === 'string');
}

export function cookiePair(response: Response, name: string): string {
  const cookie = responseCookies(response).find((value) =>
    value.startsWith(`${name}=`),
  );
  if (!cookie) throw new Error(`Response did not set ${name}`);
  return cookie.split(';')[0];
}

export function csrfOf(response: Response): string {
  const value: unknown = response.headers[CSRF_HEADER];
  if (typeof value !== 'string' || !value) {
    throw new Error('Response did not expose its CSRF token');
  }
  return value;
}

export async function proofAt(
  agent: TestAgent,
  origin?: string,
  referer?: string,
): Promise<string> {
  const pending = agent.get('/api/auth/browser-proof');
  if (origin) pending.set('Origin', origin);
  if (referer) pending.set('Referer', referer);
  return csrfOf(await pending.expect(200));
}

// feature:email-password:start
export async function signInAt(
  agent: TestAgent,
  credentials: SeedUser,
  origin?: string,
  referer?: string,
): Promise<Response> {
  const proof = await proofAt(agent, origin, referer);
  const pending = agent.post('/api/auth/login').set(CSRF_HEADER, proof);
  if (origin) pending.set('Origin', origin);
  if (referer) pending.set('Referer', referer);
  return pending.send(credentials).expect(200);
}
// feature:email-password:end

export async function identityEmail(
  e2e: E2eApp,
  cookie: string,
  origin?: string,
  referer?: string,
): Promise<string | null> {
  const pending = request(e2e.httpServer)
    .get('/api/auth/identity')
    .set('Cookie', cookie);
  if (origin) pending.set('Origin', origin);
  if (referer) pending.set('Referer', referer);
  const identity = unwrapIdentityBody((await pending.expect(200)).body);
  return identity.authenticated ? identity.user.email : null;
}
