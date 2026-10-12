import { createHash } from 'crypto';
import { DEFAULT_API_AUDIENCE } from '../../constants/client-ids';
import { AuthorizeQuery, OauthFailure } from '../oauth/native-oauth.types';

export const NATIVE_CLIENT_ID = 'native-app';
export const NATIVE_REDIRECT = 'myapp://callback';
export const NATIVE_META = { ip: '203.0.113.10', userAgent: 'NativeTest/1' };

export function nativeAuthorizeQuery(
  verifier: string,
  overrides: Partial<AuthorizeQuery> = {},
): AuthorizeQuery {
  return {
    response_type: 'code',
    client_id: NATIVE_CLIENT_ID,
    redirect_uri: NATIVE_REDIRECT,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'state-1',
    scope: DEFAULT_API_AUDIENCE,
    ...overrides,
  };
}

export function approvalRedirectUri(
  approval: { redirectUri: string } | OauthFailure,
): string {
  if ('ok' in approval) {
    throw new Error(approval.error);
  }
  return approval.redirectUri;
}
