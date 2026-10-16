import { HTTP_METHOD, TRANSPORT_FAILURE } from './constants';
import { isSdkError } from './errors';
import { API_PATHS } from './paths';
import { unwrapObject } from './shapes';
import { unwrapTokenSet } from './tokens';
import { createNativeAuthClient } from './native-auth/client';
import { createAuthArea, type ApiClientAuth } from './areas/auth';
import { createOAuthArea, type ApiClientOAuth } from './areas/oauth';
import { createUserArea, type ApiClientUser } from './areas/user';
import { createPasskeysArea, type ApiClientPasskeys } from './areas/passkeys';
import { createAdminArea, type ApiClientAdmin } from './areas/admin';
import { createAccountArea, type ApiClientAccount } from './areas/account';
import {
  TransportError,
  isTransportError,
  toTransportError,
  type Transport,
  type TransportRequest,
  type TransportResponse,
  type TransportSignal,
} from './transport';
import type { OAuthTokenRequest, TokenSet } from './types';
import type { NativeAuthClient } from './types/native-auth';

/** Per-call options. An untyped cancellation rejects with `TransportError` reason `aborted`. */
export interface CallOptions<TSignal extends TransportSignal = TransportSignal> {
  signal?: TSignal;
  headers?: Readonly<Record<string, string>>;
}

/**
 * The typed client. Every call reads the current session from the credential
 * the request arrived on: the session cookie in the browser, the bearer token
 * on a native transport.
 */
export interface ApiClient<TSignal extends TransportSignal = TransportSignal>
  extends
    ApiClientUser<TSignal>,
    ApiClientAuth<TSignal>,
    ApiClientOAuth<TSignal>,
    ApiClientPasskeys<TSignal>,
    ApiClientAdmin<TSignal>,
    ApiClientAccount<TSignal> {
  nativeAuth: NativeAuthClient<TSignal>;
}

/**
 * A typed client over an injected transport. Caching, retries and credentials
 * belong to the transport and to the engine above this client.
 */
export function createApiClient<TSignal extends TransportSignal = TransportSignal>(
  transport: Transport<TSignal>,
): ApiClient<TSignal> {
  type Options = CallOptions<TSignal> | undefined;
  type Call = Omit<TransportRequest<TSignal>, 'signal'>;

  // Only the transport call is guarded: an unwrap failure must stay an ApiError.
  const send = async (call: Call, options: Options): Promise<TransportResponse> => {
    const signal = options?.signal;
    if (signal?.aborted) {
      throw new TransportError(TRANSPORT_FAILURE.ABORTED);
    }
    try {
      const request = {
        ...call,
        ...(options?.headers === undefined ? {} : { headers: options.headers }),
        ...(signal === undefined ? {} : { signal }),
      };
      return await transport.request(request);
    } catch (error) {
      if (isSdkError(error) && !isTransportError(error)) throw error;
      throw toTransportError(error, signal);
    }
  };
  const sendObject = async <T extends object>(call: Call, options: Options): Promise<T> =>
    unwrapObject<T>(await send(call, options));
  const requestTokens = async (body: OAuthTokenRequest, options: Options): Promise<TokenSet> =>
    unwrapTokenSet(
      await send({ method: HTTP_METHOD.POST, path: API_PATHS.oauth.token, body }, options),
    );
  const senders = { send, sendObject, requestTokens };

  return {
    nativeAuth: createNativeAuthClient(send),
    ...createUserArea<TSignal>(senders),
    ...createAuthArea<TSignal>(senders),
    ...createOAuthArea<TSignal>(senders),
    ...createPasskeysArea<TSignal>(senders),
    ...createAdminArea<TSignal>(senders),
    ...createAccountArea<TSignal>(senders),
  };
}
