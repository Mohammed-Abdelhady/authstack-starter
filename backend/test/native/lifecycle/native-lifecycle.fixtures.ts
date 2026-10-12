import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import type { NativeAttemptResult } from '@app/sdk';
import { NativeAttemptService } from '../../../src/auth/native/services/native-attempt.service';
import { NATIVE_ATTEMPT_HEADER } from '../../../src/auth/native/constants/native-attempt';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import type { MailOptions } from '../../../src/mail/interfaces/mail-options.interface';
import type { NativeApplicationConfiguration } from '../../../src/config/types/native-application.type';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';

export const NATIVE_LIFECYCLE_APPLICATION: NativeApplicationConfiguration = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native lifecycle test client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: {
    emailLink: true, // feature:magic-link
    registration: true, // feature:email-password
    recovery: true, // feature:email-password
  },
};

export type LifecycleFlow = 'signIn' | 'registration' | 'recovery';
export type StartedLifecycleAttempt = ReturnType<
  typeof unwrapNativeAttemptStart
>;

export async function bootNativeLifecycleApp(): Promise<E2eApp> {
  return bootE2eApp(0, {
    nativeEnabled: true,
    nativeCustomSchemeAllowed: true,
    nativeApplications: [NATIVE_LIFECYCLE_APPLICATION],
    magicLinkEnabled: true, // feature:magic-link
  });
}

export async function startLifecycleAttempt(
  e2e: E2eApp,
  flow: LifecycleFlow,
): Promise<StartedLifecycleAttempt> {
  const verifier = randomBytes(32).toString('base64url');
  const query = nativeAuthorizeQuery(verifier);
  const response = await request(e2e.httpServer)
    .post('/api/auth/native/attempts')
    .send({
      clientId: NATIVE_CLIENT_ID,
      redirectUri: NATIVE_REDIRECT,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      state: query.state,
      scopes: [DEFAULT_API_AUDIENCE],
      flow,
    })
    .expect(201);
  return unwrapNativeAttemptStart({
    status: response.status,
    body: response.body,
  });
}

export function postLifecycle(
  e2e: E2eApp,
  attempt: StartedLifecycleAttempt,
  path: string,
  body: Record<string, unknown>,
): request.Test {
  return request(e2e.httpServer)
    .post(`/api/auth/native/attempts/${attempt.attemptId}/${path}`)
    .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
    .send(body);
}

export function parseLifecycleResult(response: {
  status: number;
  body: unknown;
}): NativeAttemptResult {
  return unwrapNativeAttemptResult(response);
}

export async function storedAttempt(
  e2e: E2eApp,
  attempt: StartedLifecycleAttempt,
) {
  return e2e.app
    .get(NativeAttemptService)
    .authenticate(attempt.attemptId, attempt.attemptSecret);
}

export function callbackFromMail(mail: MailOptions[]): URL {
  const text = mail.at(-1)?.text ?? '';
  const callback = /myapp:\/\/callback\?[^\s]+/u.exec(text)?.[0];
  if (!callback) throw new Error('mail has no native callback URI');
  return new URL(callback);
}

export function withLifecycleNativeClient(e2e: E2eApp): void {
  e2e.app
    .get(ConfigService)
    .set('auth.nativeApplications', [NATIVE_LIFECYCLE_APPLICATION]);
}
