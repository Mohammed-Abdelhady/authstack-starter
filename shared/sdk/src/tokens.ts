import { OAUTH_DPOP_TOKEN_TYPE, OAUTH_TOKEN_TYPE } from './constants';
import { malformedResponse, nonEmptyString, unwrapOAuth, type JsonObject } from './envelope';
import type { TransportResponse } from './transport';
import type { OAuthTokenResponse, TokenSet } from './types';
import type { JsonFields } from './types/json';

function malformedToken(status: number, problem: string) {
  return malformedResponse(status, `The token response is malformed: ${problem}`);
}

function requireToken(
  body: JsonFields<OAuthTokenResponse>,
  key: 'access_token' | 'refresh_token',
  status: number,
): string {
  const token = nonEmptyString(body[key]);
  if (token === undefined) {
    throw malformedToken(status, `${key} is not a non-empty string`);
  }
  return token;
}

/**
 * The reply of POST /api/oauth/token in the client's naming. Every field is
 * checked: a token set with a missing token would fail later, far from here.
 */
export function unwrapTokenSet(response: TransportResponse): TokenSet {
  const { status } = response;
  const body: JsonFields<OAuthTokenResponse> = unwrapOAuth<JsonObject>(response);
  const accessToken = requireToken(body, 'access_token', status);
  const refreshToken = requireToken(body, 'refresh_token', status);
  const expiresIn = body.expires_in;

  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw malformedToken(status, 'expires_in is not a positive number');
  }
  const tokenType = body.token_type;
  if (tokenType !== OAUTH_TOKEN_TYPE && tokenType !== OAUTH_DPOP_TOKEN_TYPE) {
    throw malformedToken(status, 'token_type is neither Bearer nor DPoP');
  }
  if (typeof body.scope !== 'string') {
    throw malformedToken(status, 'scope is not a string');
  }

  return {
    accessToken,
    tokenType,
    expiresIn,
    refreshToken,
    scope: body.scope,
  };
}
