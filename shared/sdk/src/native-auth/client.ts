import {
  NATIVE_AUTH_HEADER,
  NATIVE_AUTH_LIMITS,
  NATIVE_AUTH_PATTERN,
  NATIVE_PROVIDER_CREDENTIAL_KIND,
} from '@app/core';
import { HTTP_METHOD } from '../constants';
import type { CallOptions } from '../client';
import {
  unwrapNativeAttemptResult,
  unwrapNativeAttemptStart,
  unwrapNativeMethods,
  unwrapNativePasskeyOptions,
} from './parsers';
import { NATIVE_AUTH_PATHS } from './paths';
import type { TransportRequest, TransportResponse, TransportSignal } from '../transport';
import type {
  NativeActivationInput,
  NativeAttempt,
  NativeAttemptResult,
  NativeAttemptStart,
  NativeAuthClient as NativeAuthClientType,
  NativeEmailLinkVerificationInput,
  NativePasskeyAssertion,
  NativePasskeyOptions,
  NativePasswordInput,
  NativeProviderCredential,
  NativeRecoveryConfirmationInput,
  NativeSecondFactorInput,
} from '../types/native-auth';

export type NativeRequestSender<TSignal extends TransportSignal> = (
  call: Omit<TransportRequest<TSignal>, 'signal'>,
  options?: CallOptions<TSignal>,
) => Promise<TransportResponse>;

function requireBoundedString(value: string, field: string, limit: number): void {
  if (value.length === 0 || value.trim().length === 0 || value.length > limit) {
    throw new TypeError(`${field} is outside its bounds`);
  }
}

function nativeOptions<TSignal extends TransportSignal>(
  options: CallOptions<TSignal> | undefined,
  attempt?: NativeAttempt,
): CallOptions<TSignal> | undefined {
  if (attempt !== undefined) {
    requireBoundedString(attempt.id, 'attempt id', NATIVE_AUTH_LIMITS.ATTEMPT_ID);
    if (attempt.id === '.' || attempt.id === '..') throw new TypeError('attempt id is not safe');
    requireBoundedString(
      attempt.secret,
      'attempt secret',
      NATIVE_AUTH_LIMITS.ATTEMPT_SECRET_LENGTH,
    );
    if (!NATIVE_AUTH_PATTERN.BASE64URL_SHA256.test(attempt.secret)) {
      throw new TypeError('attempt secret has an invalid format');
    }
  }
  const headers = Object.fromEntries(
    Object.entries(options?.headers ?? {}).filter(([name]) => {
      const key = name.toLowerCase();
      return (
        key !== 'cookie' &&
        key !== 'authorization' &&
        key !== 'origin' &&
        key !== NATIVE_AUTH_HEADER.toLowerCase()
      );
    }),
  );
  if (attempt !== undefined) headers[NATIVE_AUTH_HEADER] = attempt.secret;
  return {
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  };
}

function validateProviderCredential(input: NativeProviderCredential): void {
  switch (input.kind) {
    case NATIVE_PROVIDER_CREDENTIAL_KIND.GOOGLE_IDENTITY_TOKEN:
      requireBoundedString(input.identityToken, 'identity token', NATIVE_AUTH_LIMITS.TOKEN);
      requireBoundedString(
        input.nonceDigest,
        'nonce digest',
        NATIVE_AUTH_LIMITS.PROVIDER_NONCE_DIGEST_LENGTH,
      );
      if (!NATIVE_AUTH_PATTERN.SHA256_HEX.test(input.nonceDigest))
        throw new TypeError('nonce digest has an invalid format');
      return;
    case NATIVE_PROVIDER_CREDENTIAL_KIND.APPLE_IDENTITY_TOKEN_AND_CODE:
      requireBoundedString(input.identityToken, 'identity token', NATIVE_AUTH_LIMITS.TOKEN);
      requireBoundedString(input.authorizationCode, 'authorization code', NATIVE_AUTH_LIMITS.TOKEN);
      requireBoundedString(
        input.nonceDigest,
        'nonce digest',
        NATIVE_AUTH_LIMITS.PROVIDER_NONCE_DIGEST_LENGTH,
      );
      if (!NATIVE_AUTH_PATTERN.SHA256_HEX.test(input.nonceDigest))
        throw new TypeError('nonce digest has an invalid format');
      return;
    case NATIVE_PROVIDER_CREDENTIAL_KIND.FACEBOOK_LIMITED_TOKEN:
      requireBoundedString(
        input.authenticationToken,
        'authentication token',
        NATIVE_AUTH_LIMITS.TOKEN,
      );
      requireBoundedString(
        input.nonceDigest,
        'nonce digest',
        NATIVE_AUTH_LIMITS.PROVIDER_NONCE_DIGEST_LENGTH,
      );
      if (!NATIVE_AUTH_PATTERN.SHA256_HEX.test(input.nonceDigest))
        throw new TypeError('nonce digest has an invalid format');
      return;
    case NATIVE_PROVIDER_CREDENTIAL_KIND.FACEBOOK_ACCESS_TOKEN:
      requireBoundedString(input.accessToken, 'access token', NATIVE_AUTH_LIMITS.TOKEN);
  }
}

export function createNativeAuthClient<TSignal extends TransportSignal>(
  send: NativeRequestSender<TSignal>,
): NativeAuthClientType<TSignal> {
  const attemptCall = async (
    method: typeof HTTP_METHOD.POST,
    pathForAttempt: (attemptId: string) => string,
    attempt: NativeAttempt,
    options?: CallOptions<TSignal>,
    body?: unknown,
  ): Promise<NativeAttemptResult> => {
    const requestOptions = nativeOptions(options, attempt);
    const path = pathForAttempt(attempt.id);
    return unwrapNativeAttemptResult(
      await send({ method, path, ...(body === undefined ? {} : { body }) }, requestOptions),
    );
  };

  return {
    methods: async (clientId, options) =>
      unwrapNativeMethods(
        await send(
          { method: HTTP_METHOD.GET, path: NATIVE_AUTH_PATHS.methods(clientId) },
          nativeOptions(options),
        ),
      ),
    start: async (input: NativeAttemptStart, options) =>
      unwrapNativeAttemptStart(
        await send(
          { method: HTTP_METHOD.POST, path: NATIVE_AUTH_PATHS.attempts, body: input },
          nativeOptions(options),
        ),
      ),
    password: (attempt, input: NativePasswordInput, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.password, attempt, options, input),
    provider: (attempt, input, options) => {
      validateProviderCredential(input);
      return attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.provider, attempt, options, input);
    },
    passkeyOptions: async (attempt, options): Promise<NativePasskeyOptions> =>
      unwrapNativePasskeyOptions(
        await send(
          { method: HTTP_METHOD.POST, path: NATIVE_AUTH_PATHS.passkeyOptions(attempt.id) },
          nativeOptions(options, attempt),
        ),
      ),
    passkeyVerify: (attempt, input: NativePasskeyAssertion, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.passkeyVerify, attempt, options, {
        response: input,
      }),
    secondFactor: (attempt, input: NativeSecondFactorInput, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.secondFactor, attempt, options, input),
    requestEmailLink: (attempt, email, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.requestEmailLink, attempt, options, {
        email,
      }),
    verifyEmailLink: (attempt, input: NativeEmailLinkVerificationInput, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.verifyEmailLink, attempt, options, input),
    register: (attempt, email, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.register, attempt, options, { email }),
    activate: (attempt, input: NativeActivationInput, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.activate, attempt, options, input),
    requestRecovery: (attempt, email, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.requestRecovery, attempt, options, { email }),
    confirmRecovery: (attempt, input: NativeRecoveryConfirmationInput, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.confirmRecovery, attempt, options, input),
    consent: (attempt, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.consent, attempt, options),
    cancel: (attempt, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.cancel, attempt, options),
  };
}
