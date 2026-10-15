import { ConfigService } from '@nestjs/config';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import type request from 'supertest';
import { HashService } from '../../../src/common/services/hash.service';
import { MAIL_CATALOGUES } from '../../../src/mail/catalog/mail-catalogue';
import type { SupportedLocale } from '../../../src/common/constants/locales';
import type { NativeApplicationConfiguration } from '../../../src/config/types/native-application.type';
import {
  EMAIL_CODE_PURPOSE,
  EmailCodeStore,
  type StoredEmailCode,
} from '../../../src/auth/pending-codes/email-code.store';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import {
  NATIVE_LIFECYCLE_APPLICATION,
  postLifecycle,
  type StartedLifecycleAttempt,
} from '../lifecycle/native-lifecycle.fixtures';

export const EMAIL_CODE_APPLICATION: NativeApplicationConfiguration = {
  ...NATIVE_LIFECYCLE_APPLICATION,
  signIn: { emailLink: true, emailCode: true },
};

/** Ten minutes, the default `EMAIL_CODE_EXPIRES_IN`. */
export const CODE_LIFETIME_MS = 600_000;
/** The attempt's own lifetime, longer than the code's. */
export const ATTEMPT_LIFETIME_MS = 900_000;

/** Email code as the application's only way in, its link half switched off. */
export const CODE_ONLY_APPLICATION: NativeApplicationConfiguration = {
  ...NATIVE_LIFECYCLE_APPLICATION,
  signIn: { emailCode: true },
};

export async function bootEmailCodeApp(
  application: NativeApplicationConfiguration = EMAIL_CODE_APPLICATION,
  magicLinkEnabled = true,
): Promise<E2eApp> {
  return bootE2eApp(0, {
    nativeEnabled: true,
    nativeCustomSchemeAllowed: true,
    nativeApplications: [application],
    magicLinkEnabled,
  });
}

/** `EMAIL_CODE_ENABLED` and the application's switch, read on every request. */
export function setEmailCode(
  e2e: E2eApp,
  enabled: boolean,
  application: NativeApplicationConfiguration = EMAIL_CODE_APPLICATION,
): void {
  const config = e2e.app.get(ConfigService);
  config.set('emailCode.enabled', enabled);
  config.set('emailCode.expiresIn', CODE_LIFETIME_MS);
  config.set('auth.nativeApplications', [application]);
}

export function requestCode(
  e2e: E2eApp,
  attempt: StartedLifecycleAttempt,
  email: string,
  locale?: SupportedLocale,
): request.Test {
  return postLifecycle(e2e, attempt, 'email-code/request', {
    email,
    ...(locale ? { locale } : {}),
  });
}

export function verifyCode(
  e2e: E2eApp,
  attempt: StartedLifecycleAttempt,
  code: string,
): request.Test {
  return postLifecycle(e2e, attempt, 'email-code/verify', { code });
}

export interface MailedSignIn {
  to: string;
  subject: string;
  text: string;
  code: string;
  link: URL | null;
}

/** The code is read where the catalogue puts it in the subject. */
export async function lastSignInMail(
  e2e: E2eApp,
  locale: SupportedLocale = 'en',
): Promise<MailedSignIn> {
  const last = (await e2e.captureMail()).at(-1);
  if (!last) throw new Error('no mail was sent');
  const [before, after] =
    MAIL_CATALOGUES[locale].signInCode.subject.split('{code}');
  if (!last.subject.startsWith(before) || !last.subject.endsWith(after)) {
    throw new Error('the last mail is not a sign-in code mail');
  }
  const code = last.subject.slice(
    before.length,
    last.subject.length - after.length,
  );
  const text = last.text ?? '';
  const link = /myapp:\/\/callback#\S+/u.exec(text)?.[0];
  return {
    to: last.to,
    subject: last.subject,
    text,
    code,
    link: link ? new URL(link) : null,
  };
}

/** A six-digit code that is not `code`. */
export function otherCode(code: string): string {
  return String((Number.parseInt(code, 10) + 1) % 1_000_000).padStart(6, '0');
}

export function storedCode(
  e2e: E2eApp,
  attempt: StartedLifecycleAttempt,
): Promise<StoredEmailCode | null> {
  return e2e.app.get(EmailCodeStore).find({
    ownerId: attempt.attemptId,
    purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
  });
}

/**
 * Watches the plain codes the server hashes, so a case can type the code a
 * request made even when that request mailed nothing.
 */
export function watchHashedCodes(e2e: E2eApp): () => string {
  const hash = jest.spyOn(e2e.app.get(HashService), 'hash');
  return () => {
    const plain = hash.mock.calls.at(-1)?.[0];
    if (typeof plain !== 'string') throw new Error('no code was hashed');
    return plain;
  };
}

export function errorCodeOf(response: { body: unknown }): unknown {
  const body = response.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const error: unknown = Reflect.get(body, 'error');
  if (typeof error !== 'object' || error === null) return undefined;
  return Reflect.get(error, 'code');
}

/**
 * The per-caller throttle forgets every caller, so the next request stands for
 * someone else. Same reset as the fixture's own: clearing only `storage`
 * leaves the hit times the next request recounts from.
 */
export function asAnotherCaller(e2e: E2eApp): void {
  const storage = e2e.app.get<ThrottlerStorageService>(getStorageToken());
  storage.onApplicationShutdown();
  storage.storage.clear();
}
