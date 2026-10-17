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

/** What a person adds when the session alone cannot prove who is asking. */
export interface OwnEmailProof {
  /** The account's password, for an account that has one. */
  password?: string;
}

/** What a mobile app sends to confirm a change staff started, for a person who may be signed out. */
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
       * Asks to move the account to `email`. Needs recent actual authentication,
       * session-bound proof, or the account password when policy permits it.
       * A required-passkey application needs its RP and user-verified proof.
       * A taken address is answered like a free one and never gets a code.
       */
      request(
        email: string,
        proof?: OwnEmailProof,
        options?: CallOptions<TSignal>,
      ): Promise<OwnEmail>;
      /** Moves the account. This session stays signed in; the others end. */
      confirm(code: string, options?: CallOptions<TSignal>): Promise<OwnEmail>;
      /**
       * Cancels the pending change, with the proof a request needs. Resolves
       * when nothing was pending too.
       */
      cancel(proof?: OwnEmailProof, options?: CallOptions<TSignal>): Promise<OwnEmail>;
      /**
       * Confirms a change staff started, from a native app with no session
       * needed. Every session of the account ends. A change the person asked
       * for is confirmed with `confirm` from a signed-in session.
       */
      confirmFromApp(
        confirmation: AppEmailChangeConfirmation,
        options?: CallOptions<TSignal>,
      ): Promise<MessageResult>;
    };
  };
}

/** The password field of a body, left out when none was given. */
function passwordOf(proof: OwnEmailProof | undefined): { password?: string } {
  return proof?.password === undefined ? {} : { password: proof.password };
}

export function createAccountArea<TSignal extends TransportSignal>({
  sendObject,
}: AreaSenders<TSignal>): ApiClientAccount<TSignal> {
  return {
    account: {
      email: {
        get: (options) =>
          sendObject({ method: HTTP_METHOD.GET, path: ACCOUNT_PATHS.email }, options),
        request: (email, proof, options) =>
          sendObject(
            {
              method: HTTP_METHOD.POST,
              path: ACCOUNT_PATHS.email,
              body: { email, ...passwordOf(proof) },
            },
            options,
          ),
        confirm: (code, options) =>
          sendObject(
            { method: HTTP_METHOD.POST, path: ACCOUNT_PATHS.confirmEmail, body: { code } },
            options,
          ),
        cancel: (proof, options) =>
          sendObject(
            {
              method: HTTP_METHOD.DELETE,
              path: ACCOUNT_PATHS.email,
              ...(proof?.password === undefined ? {} : { body: passwordOf(proof) }),
            },
            options,
          ),
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
