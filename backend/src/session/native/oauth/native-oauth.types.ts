import { NATIVE_ACCESS_TOKEN_TYPE } from '../../constants/session-policy';

export const OAUTH_ERROR = {
  INVALID_REQUEST: 'invalid_request',
  INVALID_CLIENT: 'invalid_client',
  INVALID_GRANT: 'invalid_grant',
  INVALID_DPOP_PROOF: 'invalid_dpop_proof',
  UNAUTHORIZED_CLIENT: 'unauthorized_client',
  UNSUPPORTED_GRANT_TYPE: 'unsupported_grant_type',
  UNSUPPORTED_RESPONSE_TYPE: 'unsupported_response_type',
  INVALID_SCOPE: 'invalid_scope',
  ACCESS_DENIED: 'access_denied',
  USE_DPOP_NONCE: 'use_dpop_nonce',
} as const;

export const NATIVE_AUTH_INTENT = 'native_login';

export type OauthErrorCode = (typeof OAUTH_ERROR)[keyof typeof OAUTH_ERROR];

export interface OauthFailure {
  ok: false;
  status: number;
  error: OauthErrorCode;
  error_description?: string;
  dpopNonce?: string;
}

export interface AuthorizeBegin {
  ok: true;
  transactionId: string;
}

export interface NativeAuthorizeTransactionDetails {
  applicationName: string;
  platform: string;
  expiresAt: string;
  alreadyGranted: boolean;
}

export interface TokenSuccess {
  ok: true;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  tokenType: typeof NATIVE_ACCESS_TOKEN_TYPE;
}

export interface RevokeSuccess {
  ok: true;
}

export function oauthFailure(
  status: number,
  error: OauthErrorCode,
  errorDescription?: string,
): OauthFailure {
  if (errorDescription === undefined) {
    return { ok: false, status, error };
  }
  return { ok: false, status, error, error_description: errorDescription };
}

export interface AuthorizeQuery {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope?: string;
}

export interface TokenRequest {
  install_id?: string;
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
}

export interface RevokeRequest {
  token?: string;
  client_id?: string;
  client_secret?: string;
}

export interface ClientMeta {
  installId?: string;
  ip: string;
  userAgent: string;
}
