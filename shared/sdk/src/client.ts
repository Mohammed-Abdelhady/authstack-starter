import { unwrapAuthMethods } from './auth-methods';
import { unwrapIdentity } from './identity';
import { HTTP_METHOD, OAUTH_GRANT_TYPE, TRANSPORT_FAILURE } from './constants';
import { unwrapOAuth } from './envelope';
import { isSdkError } from './errors';
import { API_PATHS } from './paths';
import { unwrapSessionList } from './sessions';
import { unwrapObject } from './shapes';
import { unwrapTokenSet } from './tokens';
import { createNativeAuthClient } from './native-auth/client';
import {
  TransportError,
  isTransportError,
  toTransportError,
  type Transport,
  type TransportRequest,
  type TransportResponse,
  type TransportSignal,
} from './transport';
import type {
  AuthMethods,
  Identity,
  ExchangeCodeInput,
  MessageResult,
  OAuthRevokeRequest,
  OAuthTokenRequest,
  RefreshTokenInput,
  RevokeOtherSessionsResult,
  RevokeTokenInput,
  SessionList,
  TokenSet,
  UpdateProfileRequest,
  User,
} from './types';
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
export interface ApiClient<TSignal extends TransportSignal = TransportSignal> {
  nativeAuth: NativeAuthClient<TSignal>;
  profile: {
    get(options?: CallOptions<TSignal>): Promise<User>;
    update(changes: UpdateProfileRequest, options?: CallOptions<TSignal>): Promise<User>;
  };
  sessions: {
    /**
     * Lists browser and native sessions. The row of the session making the
     * call, cookie or bearer, reads `isCurrent: true` and carries its
     * `credentialPurpose`.
     */
    list(options?: CallOptions<TSignal>): Promise<SessionList>;
    /**
     * Refuses the session making the call with `CANNOT_REVOKE_CURRENT_SESSION`.
     * Rejects with a `TypeError` for an empty id, `.` or `..`.
     */
    revoke(sessionId: string, options?: CallOptions<TSignal>): Promise<MessageResult>;
    /** Revokes every session except the one making the call. */
    revokeOthers(options?: CallOptions<TSignal>): Promise<RevokeOtherSessionsResult>;
  };
  auth: {
    identity(options?: CallOptions<TSignal>): Promise<Identity>;
    methods(options?: CallOptions<TSignal>): Promise<AuthMethods>;
    /**
     * Signs out the session making the call: the cookie session in the
     * browser, the native token family on a bearer transport.
     */
    signOut(options?: CallOptions<TSignal>): Promise<MessageResult>;
  };
  /** The server refuses these three when a session cookie is sent: bearer transports only. */
  oauth: {
    exchangeCode(input: ExchangeCodeInput, options?: CallOptions<TSignal>): Promise<TokenSet>;
    refresh(input: RefreshTokenInput, options?: CallOptions<TSignal>): Promise<TokenSet>;
    revoke(input: RevokeTokenInput, options?: CallOptions<TSignal>): Promise<void>;
  };
}

function toRevokeRequest(input: RevokeTokenInput): OAuthRevokeRequest {
  if (input.clientId === undefined) {
    return { token: input.token };
  }
  return { token: input.token, client_id: input.clientId };
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

  return {
    nativeAuth: createNativeAuthClient(send),
    profile: {
      get: (options) =>
        sendObject({ method: HTTP_METHOD.GET, path: API_PATHS.user.profile }, options),
      update: (changes, options) =>
        sendObject(
          { method: HTTP_METHOD.PATCH, path: API_PATHS.user.profile, body: changes },
          options,
        ),
    },
    sessions: {
      list: async (options) =>
        unwrapSessionList(
          await send({ method: HTTP_METHOD.GET, path: API_PATHS.user.sessions }, options),
        ),
      // Async, so a refused id is a rejection like every other failure.
      revoke: async (sessionId, options) =>
        sendObject(
          { method: HTTP_METHOD.DELETE, path: API_PATHS.user.session(sessionId) },
          options,
        ),
      revokeOthers: (options) =>
        sendObject({ method: HTTP_METHOD.POST, path: API_PATHS.user.revokeOtherSessions }, options),
    },
    auth: {
      identity: async (options) =>
        unwrapIdentity(
          await send({ method: HTTP_METHOD.GET, path: API_PATHS.auth.identity }, options),
        ),
      methods: async (options) =>
        unwrapAuthMethods(
          await send({ method: HTTP_METHOD.GET, path: API_PATHS.auth.methods }, options),
        ),
      signOut: (options) =>
        sendObject({ method: HTTP_METHOD.POST, path: API_PATHS.auth.logout }, options),
    },
    oauth: {
      exchangeCode: (input, options) =>
        requestTokens(
          {
            grant_type: OAUTH_GRANT_TYPE.AUTHORIZATION_CODE,
            code: input.code,
            redirect_uri: input.redirectUri,
            client_id: input.clientId,
            code_verifier: input.codeVerifier,
          },
          options,
        ),
      refresh: (input, options) =>
        requestTokens(
          {
            grant_type: OAUTH_GRANT_TYPE.REFRESH_TOKEN,
            refresh_token: input.refreshToken,
            client_id: input.clientId,
          },
          options,
        ),
      revoke: async (input, options) => {
        const call = {
          method: HTTP_METHOD.POST,
          path: API_PATHS.oauth.revoke,
          body: toRevokeRequest(input),
        };
        unwrapOAuth(await send(call, options));
      },
    },
  };
}
