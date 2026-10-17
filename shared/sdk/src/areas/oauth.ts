import type { CallOptions } from '../client';
import { HTTP_METHOD, OAUTH_GRANT_TYPE } from '../constants';
import { unwrapOAuth } from '../envelope';
import type { TransportSignal } from '../transport';
import type {
  ExchangeCodeInput,
  OAuthRevokeRequest,
  OAuthTokenRequest,
  RefreshTokenInput,
  RevokeTokenInput,
  TokenSet,
} from '../types';
import type { AreaOptions, AreaSenders } from './shared';

export const OAUTH_PATHS = {
  token: '/api/oauth/token',
  revoke: '/api/oauth/revoke',
} as const;

export interface ApiClientOAuth<TSignal extends TransportSignal = TransportSignal> {
  /** The server refuses these three when a session cookie is sent: bearer transports only. */
  oauth: {
    exchangeCode(input: ExchangeCodeInput, options?: CallOptions<TSignal>): Promise<TokenSet>;
    refresh(input: RefreshTokenInput, options?: CallOptions<TSignal>): Promise<TokenSet>;
    revoke(input: RevokeTokenInput, options?: CallOptions<TSignal>): Promise<void>;
  };
}

export interface OAuthSenders<TSignal extends TransportSignal> extends AreaSenders<TSignal> {
  requestTokens(body: OAuthTokenRequest, options: AreaOptions<TSignal>): Promise<TokenSet>;
}

function toRevokeRequest(input: RevokeTokenInput): OAuthRevokeRequest {
  if (input.clientId === undefined) {
    return { token: input.token };
  }
  return { token: input.token, client_id: input.clientId };
}

export function createOAuthArea<TSignal extends TransportSignal>({
  send,
  requestTokens,
}: OAuthSenders<TSignal>): ApiClientOAuth<TSignal> {
  return {
    oauth: {
      exchangeCode: (input, options) =>
        requestTokens(
          {
            grant_type: OAUTH_GRANT_TYPE.AUTHORIZATION_CODE,
            code: input.code,
            redirect_uri: input.redirectUri,
            client_id: input.clientId,
            code_verifier: input.codeVerifier,
            ...(input.installId === undefined ? {} : { install_id: input.installId }),
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
          path: OAUTH_PATHS.revoke,
          body: toRevokeRequest(input),
        };
        unwrapOAuth(await send(call, options));
      },
    },
  };
}
