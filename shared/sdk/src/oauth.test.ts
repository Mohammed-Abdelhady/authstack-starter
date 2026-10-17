import { describe, expect, it } from 'vitest';
import { unwrapOAuth } from './envelope';
import { ApiError, OAuthError } from './errors';
import { respond, thrownBy } from './test-support';
import { unwrapTokenSet } from './tokens';

const TOKEN_BODY = {
  access_token: 'at-1',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'rt-1',
  scope: 'api',
};

describe('unwrapOAuth', () => {
  it('returns the empty object a revoke answers with', () => {
    expect(unwrapOAuth(respond(200, {}))).toEqual({});
  });

  it('throws OAuthError with the status and the error string', () => {
    const error = thrownBy(() => unwrapOAuth(respond(400, { error: 'invalid_grant' })));

    expect(error).toBeInstanceOf(OAuthError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, error: 'invalid_grant' });
    expect((error as OAuthError).errorDescription).toBeUndefined();
  });

  it('carries the OAuth reason and DPoP nonce from the wire response', () => {
    const error = thrownBy(() =>
      unwrapOAuth(
        respond(
          400,
          { error: 'use_dpop_nonce', error_description: 'NATIVE_DPOP_REQUIRED' },
          { 'DPoP-Nonce': 'nonce-from-server' },
        ),
      ),
    );

    expect(error).toMatchObject({
      status: 400,
      error: 'use_dpop_nonce',
      errorDescription: 'NATIVE_DPOP_REQUIRED',
      dpopNonce: 'nonce-from-server',
    });
  });

  it('falls back to ApiError for the application envelope a throttle answers with', () => {
    const error = thrownBy(() =>
      unwrapOAuth(
        respond(429, {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            details: { retryAfter: 60 },
          },
          requestId: 'req-9',
        }),
      ),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(OAuthError);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
      requestId: 'req-9',
    });
  });

  it.each([
    ['no JSON body', undefined],
    ['an HTML page', '<html>Bad Gateway</html>'],
    ['an error that is not a string', { error: 123 }],
    ['an empty error string', { error: '' }],
  ])('falls back to ApiError with the status code for %s', (_label, body) => {
    const error = thrownBy(() => unwrapOAuth(respond(502, body)));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it.each([
    ['no body', undefined],
    ['a string', 'ok'],
    ['an array', []],
  ])('refuses a success status that carries %s', (_label, body) => {
    const error = thrownBy(() => unwrapOAuth(respond(200, body)));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'UNKNOWN_ERROR' });
    expect((error as ApiError).message).toMatch(/not a JSON object/);
  });
});

describe('unwrapTokenSet', () => {
  it('returns the token set in the client naming', () => {
    expect(unwrapTokenSet(respond(200, { ...TOKEN_BODY }))).toEqual({
      accessToken: 'at-1',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshToken: 'rt-1',
      scope: 'api',
    });
  });

  it('accepts the DPoP token type returned by a bound exchange', () => {
    expect(unwrapTokenSet(respond(200, { ...TOKEN_BODY, token_type: 'DPoP' }))).toEqual({
      accessToken: 'at-1',
      tokenType: 'DPoP',
      expiresIn: 900,
      refreshToken: 'rt-1',
      scope: 'api',
    });
  });

  it('accepts an empty scope', () => {
    expect(unwrapTokenSet(respond(200, { ...TOKEN_BODY, scope: '' })).scope).toBe('');
  });

  it.each([
    ['an empty body', {}, /access_token/],
    ['a missing access token', { ...TOKEN_BODY, access_token: undefined }, /access_token/],
    ['an empty access token', { ...TOKEN_BODY, access_token: '' }, /access_token/],
    ['an access token that is not a string', { ...TOKEN_BODY, access_token: 42 }, /access_token/],
    ['a missing refresh token', { ...TOKEN_BODY, refresh_token: undefined }, /refresh_token/],
    ['an empty refresh token', { ...TOKEN_BODY, refresh_token: '' }, /refresh_token/],
    ['a missing lifetime', { ...TOKEN_BODY, expires_in: undefined }, /expires_in/],
    ['a zero lifetime', { ...TOKEN_BODY, expires_in: 0 }, /expires_in/],
    ['a negative lifetime', { ...TOKEN_BODY, expires_in: -1 }, /expires_in/],
    ['a lifetime sent as a string', { ...TOKEN_BODY, expires_in: '900' }, /expires_in/],
    ['a missing token type', { ...TOKEN_BODY, token_type: undefined }, /token_type/],
    ['another token type', { ...TOKEN_BODY, token_type: 'mac' }, /token_type/],
    ['a lower-case token type', { ...TOKEN_BODY, token_type: 'bearer' }, /token_type/],
    ['a missing scope', { ...TOKEN_BODY, scope: undefined }, /scope/],
  ])('refuses %s', (_label, body, names) => {
    const error = thrownBy(() => unwrapTokenSet(respond(200, body)));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'UNKNOWN_ERROR' });
    expect((error as ApiError).message).toMatch(names);
  });

  it('raises a refused grant as OAuthError before looking at the fields', () => {
    const error = thrownBy(() => unwrapTokenSet(respond(400, { error: 'invalid_grant' })));

    expect(error).toBeInstanceOf(OAuthError);
    expect(error).toMatchObject({ status: 400, error: 'invalid_grant' });
  });
});
