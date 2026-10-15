import type { CallOptions } from '../client';
import { HTTP_METHOD } from '../constants';
import type { TransportSignal } from '../transport';
import type { MessageResult } from '../types';
import type { AreaSenders } from './shared';

export const ACCOUNT_PATHS = {
  email: '/api/user/email',
  confirmEmail: '/api/user/email/confirm',
  confirmEmailFromApp: '/api/auth/native/email-change/confirm',
} as const;

/** The account's address, and the one it waits to confirm. */
export interface OwnEmail {
  email: string;
  pendingEmail?: string;
}

/** What a mobile app sends to confirm a change for a person who may be signed out. */
export interface AppEmailChangeConfirmation {
  /** The app's registered client id. */
  clientId: string;
  /** The new address the code was mailed to. */
  email: string;
  code: string;
}

export interface ApiClientAccount<TSignal extends TransportSignal = TransportSignal> {
  account: {
    email: {
      get(options?: CallOptions<TSignal>): Promise<OwnEmail>;
      /**
       * Asks to move the account to `email`. Needs a sign-in in the last five
       * minutes, or rejects with `REAUTH_REQUIRED`. A taken address is
       * answered like a free one and never gets a code.
       */
      request(email: string, options?: CallOptions<TSignal>): Promise<OwnEmail>;
      /** Moves the account. This session stays signed in; the others end. */
      confirm(code: string, options?: CallOptions<TSignal>): Promise<OwnEmail>;
      /** Cancels the pending change. Resolves when nothing was pending too. */
      cancel(options?: CallOptions<TSignal>): Promise<OwnEmail>;
      /**
       * Confirms a change, started by staff or by the person, from a native
       * app with no session needed. Every session of the account ends.
       */
      confirmFromApp(
        confirmation: AppEmailChangeConfirmation,
        options?: CallOptions<TSignal>,
      ): Promise<MessageResult>;
    };
  };
}

export function createAccountArea<TSignal extends TransportSignal>({
  sendObject,
}: AreaSenders<TSignal>): ApiClientAccount<TSignal> {
  return {
    account: {
      email: {
        get: (options) =>
          sendObject({ method: HTTP_METHOD.GET, path: ACCOUNT_PATHS.email }, options),
        request: (email, options) =>
          sendObject(
            { method: HTTP_METHOD.POST, path: ACCOUNT_PATHS.email, body: { email } },
            options,
          ),
        confirm: (code, options) =>
          sendObject(
            { method: HTTP_METHOD.POST, path: ACCOUNT_PATHS.confirmEmail, body: { code } },
            options,
          ),
        cancel: (options) =>
          sendObject({ method: HTTP_METHOD.DELETE, path: ACCOUNT_PATHS.email }, options),
        confirmFromApp: (confirmation, options) =>
          sendObject(
            {
              method: HTTP_METHOD.POST,
              path: ACCOUNT_PATHS.confirmEmailFromApp,
              body: { ...confirmation },
            },
            options,
          ),
      },
    },
  };
}
