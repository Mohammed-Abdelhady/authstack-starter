import type { CallOptions } from '../client';
import { unwrapNativePasskeyOptions } from '../native-auth/parsers';
import type { NativePasskeyOptions, NativePasskeyAssertion } from '../types/native-auth';
import { HTTP_METHOD } from '../constants';
import {
  unwrapPasskeyCreationOptions,
  unwrapPasskeyList,
  unwrapPasskeySummary,
} from '../passkeys/parsers';
import type { TransportSignal } from '../transport';
import type { MessageResult } from '../types';
import type {
  PasskeyCreationOptions,
  PasskeyList,
  PasskeyRegistrationInput,
  PasskeySummary,
} from '../types/passkeys';
import { pathSegment } from './path-segment';
import type { AreaSenders } from './shared';

export type * from '../types/passkeys';
export { unwrapPasskeyList, unwrapPasskeyListBody } from '../passkeys/parsers';

export const PASSKEY_PATHS = {
  list: '/api/auth/passkeys',
  /** @throws TypeError for an empty id, `.` or `..` */
  passkey: (passkeyId: string) => `/api/auth/passkeys/${pathSegment(passkeyId, 'passkey id')}`,
  nativeRegistrationOptions: '/api/auth/native/passkeys/register/options',
  nativeRegistrationVerify: '/api/auth/native/passkeys/register/verify',
  nativeProofOptions: '/api/auth/native/proof/options',
  nativeProofVerify: '/api/auth/native/proof/verify',
} as const;

export interface ApiClientPasskeys<TSignal extends TransportSignal = TransportSignal> {
  /**
   * The account's passkeys. Listing, renaming and removing take the browser
   * session or a mobile access token; registration below takes the token only.
   */
  passkeys: {
    nativeProofOptions(options?: CallOptions<TSignal>): Promise<NativePasskeyOptions>;
    nativeProofVerify(
      assertion: NativePasskeyAssertion,
      options?: CallOptions<TSignal>,
    ): Promise<{ provedAt: string }>;
    list(options?: CallOptions<TSignal>): Promise<PasskeyList>;
    /** Refused with `VALIDATION_ERROR` for an empty or blank name, or one over 64 characters. */
    rename(
      passkeyId: string,
      name: string,
      options?: CallOptions<TSignal>,
    ): Promise<PasskeySummary>;
    /** Refused with `PASSKEY_LAST_SIGN_IN_METHOD` when it is the last way in. */
    remove(passkeyId: string, options?: CallOptions<TSignal>): Promise<MessageResult>;
    /**
     * Options for the system prompt. Refused with `REAUTH_REQUIRED` when the
     * sign-in is over five minutes old.
     */
    nativeRegistrationOptions(options?: CallOptions<TSignal>): Promise<PasskeyCreationOptions>;
    nativeRegistrationVerify(
      input: PasskeyRegistrationInput,
      options?: CallOptions<TSignal>,
    ): Promise<PasskeySummary>;
  };
}

export function createPasskeysArea<TSignal extends TransportSignal>({
  send,
  sendObject,
}: AreaSenders<TSignal>): ApiClientPasskeys<TSignal> {
  return {
    passkeys: {
      nativeProofOptions: async (options) =>
        unwrapNativePasskeyOptions(
          await send({ method: HTTP_METHOD.POST, path: PASSKEY_PATHS.nativeProofOptions }, options),
        ),
      nativeProofVerify: (body, options) =>
        sendObject(
          { method: HTTP_METHOD.POST, path: PASSKEY_PATHS.nativeProofVerify, body },
          options,
        ),
      list: async (options) =>
        unwrapPasskeyList(
          await send({ method: HTTP_METHOD.GET, path: PASSKEY_PATHS.list }, options),
        ),
      // Async, so a refused id is a rejection like every other failure.
      rename: async (passkeyId, name, options) =>
        unwrapPasskeySummary(
          await send(
            { method: HTTP_METHOD.PATCH, path: PASSKEY_PATHS.passkey(passkeyId), body: { name } },
            options,
          ),
        ),
      remove: async (passkeyId, options) =>
        sendObject({ method: HTTP_METHOD.DELETE, path: PASSKEY_PATHS.passkey(passkeyId) }, options),
      nativeRegistrationOptions: async (options) =>
        unwrapPasskeyCreationOptions(
          await send(
            { method: HTTP_METHOD.POST, path: PASSKEY_PATHS.nativeRegistrationOptions },
            options,
          ),
        ),
      nativeRegistrationVerify: async (input, options) =>
        unwrapPasskeySummary(
          await send(
            { method: HTTP_METHOD.POST, path: PASSKEY_PATHS.nativeRegistrationVerify, body: input },
            options,
          ),
        ),
    },
  };
}
