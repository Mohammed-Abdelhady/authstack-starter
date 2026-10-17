import type { SupportedLocale } from '../../src/common/constants/locales';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request, { type Response, type Test } from 'supertest';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import {
  EmailCodeStore,
  EMAIL_CODE_PURPOSE,
} from '../../src/auth/pending-codes/email-code.store';
import { bootE2eApp, type E2eApp, type TestAgent } from '../utils/e2e-app';
import {
  configureBrowserApplications,
  proofAt,
  cookiePair,
  responseCookies,
} from '../utils/browser-applications.fixtures';
import { SEED_USER } from '../constants/seed-users';
import {
  lastSignInMail,
  type MailedSignIn,
} from '../native/email-code/email-code.fixtures';

export {
  lastSignInMail,
  otherCode,
  asAnotherCaller,
} from '../native/email-code/email-code.fixtures';
export {
  ADMIN_ORIGIN,
  WEB_ORIGIN,
  responseCookies,
} from '../utils/browser-applications.fixtures';
export const CODE_REQUEST = '/api/auth/email-code/request';
export const CODE_VERIFY = '/api/auth/email-code/verify';
export const CODE_LIFETIME_MS = 600_000;

export function bootBrowserCodeApp(failMail = false): Promise<E2eApp> {
  return bootE2eApp(0, {
    failMail,
    beforeStart: (app) => {
      configureBrowserApplications(app);
      app.get(ConfigService).set('emailCode.enabled', true);
      app.get(ConfigService).set('emailCode.expiresIn', CODE_LIFETIME_MS);
    },
  });
}

export async function postCode(
  browser: TestAgent,
  path: string,
  options: {
    body: Record<string, unknown>;
    origin?: string | undefined;
    proofOrigin?: string | undefined;
  },
): Promise<Response> {
  const { origin } = options;
  const proof = await proofAt(browser, options.proofOrigin ?? origin);
  const post: Test = browser.post(path).set(CSRF_HEADER, proof);
  if (origin) post.set('Origin', origin);
  return post.send(options.body);
}

export async function askCode(
  e2e: E2eApp,
  browser: TestAgent,
  options: {
    email?: string;
    origin?: string;
    locale?: string;
    mailLocale?: SupportedLocale;
  } = {},
): Promise<{ answer: Response; mail: MailedSignIn }> {
  const answer = await postCode(browser, CODE_REQUEST, {
    body: {
      email: options.email ?? SEED_USER.email,
      ...(options.locale ? { locale: options.locale } : {}),
    },
    origin: options.origin,
  });
  expect(answer.status).toBe(200);
  return { answer, mail: await lastSignInMail(e2e, options.mailLocale) };
}

export function verifyCode(
  browser: TestAgent,
  code: string,
  options: {
    origin?: string | undefined;
    proofOrigin?: string | undefined;
  } = {},
): Promise<Response> {
  return postCode(browser, CODE_VERIFY, { body: { code }, ...options });
}

export function nonceOf(response: Response): string {
  const cookie = responseCookies(response).find((value) =>
    /^ec_nonce(?:-admin)?=/u.test(value),
  );
  if (!cookie) throw new Error('No browser code nonce cookie');
  return cookie.split(';')[0];
}

export function storedCode(e2e: E2eApp, nonce: string) {
  const [name, value] = nonce.split('=');
  if (!value) throw new Error('No nonce value');
  const clientId = name === 'ec_nonce-admin' ? 'admin' : 'web';
  return e2e.app.get(EmailCodeStore).find({
    ownerId: `browser:${clientId}:${createHash('sha256').update(value).digest('hex')}`,
    purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
  });
}

export function sessionOf(response: Response, clientId = 'web'): string {
  return cookiePair(response, clientId === 'admin' ? 'sid-admin' : 'sid');
}

export async function rawVerifyCode(
  e2e: E2eApp,
  options: { nonce: string; code: string },
): Promise<Response> {
  const proof = await request(e2e.httpServer)
    .get('/api/auth/browser-proof')
    .expect(200);
  const token: unknown = proof.headers[CSRF_HEADER];
  if (typeof token !== 'string') throw new Error('No browser proof header');
  return request(e2e.httpServer)
    .post(CODE_VERIFY)
    .set(CSRF_HEADER, token)
    .set('Cookie', [
      ...responseCookies(proof).map((cookie) => cookie.split(';')[0]),
      options.nonce,
    ])
    .send({ code: options.code });
}
