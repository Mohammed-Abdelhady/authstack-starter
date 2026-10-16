import { NATIVE_AUTH_HEADER, NATIVE_AUTH_LIMITS, NATIVE_AUTH_PATTERN } from '@app/core';
import { ErrorCode } from '@app/core'; // feature:email-code
import { HTTP_METHOD } from '../constants';
import { ApiError } from '../errors'; // feature:email-code
import type { CallOptions } from '../client';
import {
  unwrapNativeAttemptResult,
  unwrapNativeAttemptStart,
  unwrapNativeMethods,
  unwrapNativePasskeyOptions,
} from './parsers';
import { NATIVE_AUTH_PATHS } from './paths';
import {
  requireBoundedString,
  requireEmail,
  requireKeys,
  requireNativeName,
  requirePassword,
  validatePasskeyAssertion,
  validateProviderCredential,
  validateStart,
  validateEmailCodeRequest, // feature:email-code
  validateEmailCodeVerification, // feature:email-code
} from './input-validation';
import type { TransportRequest, TransportResponse, TransportSignal } from '../transport';
import type {
  NativeActivationInput,
  NativeAttempt,
  NativeAttemptResult,
  NativeAttemptStart,
  NativeAuthClient as NativeAuthClientType,
  NativeEmailCodeRequestInput, // feature:email-code
  NativeEmailCodeVerificationInput, // feature:email-code
  NativeEmailLinkVerificationInput,
  NativePasskeyAssertion,
  NativePasskeyOptions,
  NativePasswordInput,
  NativeRecoveryConfirmationInput,
  NativeSecondFactorInput,
} from '../types/native-auth';

export type NativeRequestSender<TSignal extends TransportSignal> = (
  call: Omit<TransportRequest<TSignal>, 'signal'>,
  options?: CallOptions<TSignal>,
) => Promise<TransportResponse>;
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
    start: async (input: NativeAttemptStart, options) => {
      validateStart(input);
      return unwrapNativeAttemptStart(
        await send(
          { method: HTTP_METHOD.POST, path: NATIVE_AUTH_PATHS.attempts, body: input },
          nativeOptions(options),
        ),
      );
    },
    resume: async (attempt, options) => {
      const requestOptions = nativeOptions(options, attempt);
      return unwrapNativeAttemptResult(
        await send(
          { method: HTTP_METHOD.GET, path: NATIVE_AUTH_PATHS.resume(attempt.id) },
          requestOptions,
        ),
      );
    },
    password: async (attempt, input: NativePasswordInput, options) => {
      requireKeys(input, ['email', 'password'], 'password input');
      requireEmail(input.email);
      requirePassword(input.password);
      return attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.password, attempt, options, input);
    },
    provider: async (attempt, input, options) => {
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
    passkeyVerify: async (attempt, input: NativePasskeyAssertion, options) => {
      validatePasskeyAssertion(input);
      return attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.passkeyVerify, attempt, options, {
        response: input,
      });
    },
    secondFactor: async (attempt, input: NativeSecondFactorInput, options) => {
      if (input.code !== undefined) {
        requireKeys(input, ['code'], 'second factor input');
        requireBoundedString(
          input.code,
          'second factor code',
          NATIVE_AUTH_LIMITS.SECOND_FACTOR_CODE_LENGTH,
        );
        if (!NATIVE_AUTH_PATTERN.SECOND_FACTOR_CODE.test(input.code))
          throw new TypeError('second factor code has an invalid format');
      } else if (input.recoveryCode !== undefined) {
        requireKeys(input, ['recoveryCode'], 'second factor input');
        requireBoundedString(input.recoveryCode, 'recovery code', NATIVE_AUTH_LIMITS.RECOVERY_CODE);
        if (!NATIVE_AUTH_PATTERN.RECOVERY_CODE.test(input.recoveryCode))
          throw new TypeError('recovery code has an invalid format');
      } else {
        requireKeys(input, ['passkeyResponse'], 'second factor input');
        validatePasskeyAssertion(input.passkeyResponse);
      }
      return attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.secondFactor, attempt, options, input);
    },
    requestEmailLink: async (attempt, email, options) => {
      requireEmail(email);
      return attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.requestEmailLink, attempt, options, {
        email,
      });
    },
    verifyEmailLink: async (attempt, input: NativeEmailLinkVerificationInput, options) => {
      requireKeys(input, ['token', 'state'], 'email link verification');
      requireBoundedString(input.token, 'email token', NATIVE_AUTH_LIMITS.EMAIL_TOKEN);
      requireBoundedString(input.state, 'state', NATIVE_AUTH_LIMITS.STATE);
      return attemptCall(
        HTTP_METHOD.POST,
        NATIVE_AUTH_PATHS.verifyEmailLink,
        attempt,
        options,
        input,
      );
    },
    // feature:email-code:start
    requestEmailCode: async (attempt, input: NativeEmailCodeRequestInput, options) => {
      validateEmailCodeRequest(input);
      return attemptCall(
        HTTP_METHOD.POST,
        NATIVE_AUTH_PATHS.requestEmailCode,
        attempt,
        options,
        input,
      );
    },
    verifyEmailCode: async (attempt, input: NativeEmailCodeVerificationInput, options) => {
      validateEmailCodeVerification(input);
      return attemptCall(
        HTTP_METHOD.POST,
        NATIVE_AUTH_PATHS.verifyEmailCode,
        attempt,
        options,
        input,
      );
    },
    // feature:email-code:end
    register: async (attempt, email, options) => {
      requireEmail(email);
      return attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.register, attempt, options, { email });
    },
    activate: async (attempt, input: NativeActivationInput, options) => {
      requireKeys(input, ['email', 'code', 'password', 'name'], 'activation input');
      requireEmail(input.email);
      requireBoundedString(
        input.code,
        'activation code',
        NATIVE_AUTH_LIMITS.ACTIVATION_CODE_LENGTH,
      );
      if (!NATIVE_AUTH_PATTERN.ACTIVATION_CODE.test(input.code))
        throw new TypeError('activation code has an invalid format');
      requirePassword(input.password);
      const name = requireNativeName(input.name);
      return attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.activate, attempt, options, {
        ...input,
        name,
      });
    },
    requestRecovery: async (attempt, email, options) => {
      requireEmail(email);
      return attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.requestRecovery, attempt, options, {
        email,
      });
    },
    confirmRecovery: async (attempt, input: NativeRecoveryConfirmationInput, options) => {
      requireKeys(input, ['email', 'code', 'newPassword'], 'recovery confirmation');
      requireEmail(input.email);
      requireBoundedString(input.code, 'recovery code', NATIVE_AUTH_LIMITS.ACTIVATION_CODE_LENGTH);
      if (!NATIVE_AUTH_PATTERN.ACTIVATION_CODE.test(input.code))
        throw new TypeError('recovery code has an invalid format');
      requirePassword(input.newPassword);
      return attemptCall(
        HTTP_METHOD.POST,
        NATIVE_AUTH_PATHS.confirmRecovery,
        attempt,
        options,
        input,
      );
    },
    consent: (attempt, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.consent, attempt, options),
    cancel: (attempt, options) =>
      attemptCall(HTTP_METHOD.POST, NATIVE_AUTH_PATHS.cancel, attempt, options),
  };
}

// feature:email-code:start
/** The server refused an emailed code: wrong, expired, spent, or never mailed. */
export function isEmailCodeRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === ErrorCode.EMAIL_CODE_INVALID;
}
// feature:email-code:end
