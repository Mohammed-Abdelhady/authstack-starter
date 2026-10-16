import { createLocalJWKSet, exportPKCS8, jwtVerify } from 'jose';
import { AppleOAuthStrategy } from './apple-oauth.strategy';
import { Logger } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { APPLE_CLIENT_SECRET_MAX_LIFETIME_SECONDS } from '../utils/apple-client-secret.util';
import {
  SigningKey,
  configFor,
  createSigningKey,
  expectAppException,
  mockFetch,
  signIdToken,
} from './oauth-strategy.harness-spec';

const CLIENT_ID = 'com.example.service';
const TEAM_ID = 'ABCDE12345';
const KEY_ID = 'KEY1234567';
const AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const JWKS_URI = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';
const SUBJECT = '001234.abcdef.5678';
const REDIRECT_URI = 'https://api.example.com/api/auth/oauth/apple/callback';
const USER_PAYLOAD = JSON.stringify({
  name: { firstName: 'Ada', lastName: 'Lovelace' },
  email: 'ada@privaterelay.appleid.com',
});

/** ES256 key pair standing in for the .p8 sign-in key, with escaped newlines. */
async function appleSigningKey(): Promise<{
  escapedPem: string;
  verificationKey: SigningKey;
}> {
  const key = await createSigningKey('ES256', KEY_ID);
  const pem = await exportPKCS8(key.privateKey);

  return { escapedPem: pem.replace(/\n/g, '\\n'), verificationKey: key };
}

describe('AppleOAuthStrategy', () => {
  let idTokenKey: SigningKey;
  let signingPem: string;
  let signingJwks: SigningKey;

  async function idToken(claims: Record<string, unknown> = {}) {
    return signIdToken({
      key: idTokenKey,
      claims: {
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: SUBJECT,
        email: 'ada@privaterelay.appleid.com',
        email_verified: 'true',
        is_private_email: 'true',
        ...claims,
      },
    });
  }

  function strategy(overrides: Record<string, string> = {}) {
    return new AppleOAuthStrategy(
      configFor('apple', {
        clientId: CLIENT_ID,
        extra: {
          TEAM_ID,
          KEY_ID,
          PRIVATE_KEY: signingPem,
          ...overrides,
        },
      }),
    );
  }

  beforeAll(async () => {
    idTokenKey = await createSigningKey();
    const signingKey = await appleSigningKey();
    signingPem = signingKey.escapedPem;
    signingJwks = signingKey.verificationKey;
  });

  describe('isEnabled', () => {
    it('needs the Services ID and the whole sign-in key', () => {
      expect(strategy().isEnabled()).toBe(true);

      const withoutKey = new AppleOAuthStrategy(
        configFor('apple', {
          clientId: CLIENT_ID,
          extra: { TEAM_ID, KEY_ID },
        }),
      );
      expect(withoutKey.isEnabled()).toBe(false);

      const withoutServicesId = new AppleOAuthStrategy(
        configFor('apple', {
          extra: { TEAM_ID, KEY_ID, PRIVATE_KEY: signingPem },
        }),
      );
      expect(withoutServicesId.isEnabled()).toBe(false);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('asks for a form post because it requests scopes', () => {
      const url = new URL(
        strategy().getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
          nonce: 'nonce-value',
        }),
      );

      expect(url.origin + url.pathname).toBe(AUTH_URL);
      expect(url.searchParams.get('response_mode')).toBe('form_post');
      expect(url.searchParams.get('scope')).toBe('name email');
      expect(url.searchParams.get('nonce')).toBe('nonce-value');
      expect(url.searchParams.has('code_challenge')).toBe(false);
    });

    it('declares a POST callback so the state cookie can cross sites', () => {
      expect(strategy().callbackMethod).toBe('POST');
      expect(strategy().supportsPkce).toBe(false);
      expect(strategy().usesOidc).toBe(true);
    });
  });

  describe('revokeProviderToken', () => {
    const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
    const request = { token: 'apple-refresh-1', clientId: 'com.example.app' };

    it('revokes the refresh token for the client id that obtained it', async () => {
      const fetchMock = mockFetch([{ url: REVOKE_URL, body: {} }]);

      await expect(strategy().revokeProviderToken(request)).resolves.toEqual({
        kind: 'revoked',
      });
      expect(fetchMock.callTo(REVOKE_URL).body).toMatchObject({
        client_id: 'com.example.app',
        token: 'apple-refresh-1',
        token_type_hint: 'refresh_token',
      });
    });

    it('settles a token Apple says grants nothing any more', async () => {
      mockFetch([
        { url: REVOKE_URL, status: 400, body: { error: 'invalid_grant' } },
      ]);

      await expect(strategy().revokeProviderToken(request)).resolves.toEqual({
        kind: 'revoked',
      });
    });

    it('keeps the job open when Apple refuses the client', async () => {
      mockFetch([
        { url: REVOKE_URL, status: 400, body: { error: 'invalid_client' } },
      ]);

      await expect(strategy().revokeProviderToken(request)).resolves.toEqual({
        kind: 'failed',
        code: 'provider_refused',
      });
    });
  });

  describe('exchangeCode', () => {
    it('signs a short lived ES256 client secret for the token request', async () => {
      const token = await idToken({ nonce: 'nonce-value' });
      const fetchMock = mockFetch([
        { url: JWKS_URI, body: idTokenKey.jwks },
        { url: TOKEN_URL, body: { access_token: 'access', id_token: token } },
      ]);

      await strategy().exchangeCode({
        code: 'auth-code',
        redirectUri: REDIRECT_URI,
        nonce: 'nonce-value',
      });

      const clientSecret = fetchMock.callTo(TOKEN_URL).body.client_secret;
      const { payload, protectedHeader } = await jwtVerify(
        clientSecret,
        createLocalJWKSet(signingJwks.jwks),
        { issuer: TEAM_ID, audience: ISSUER },
      );

      expect(protectedHeader.alg).toBe('ES256');
      expect(protectedHeader.kid).toBe(KEY_ID);
      expect(payload.sub).toBe(CLIENT_ID);

      const lifetime = (payload.exp ?? 0) - (payload.iat ?? 0);
      expect(lifetime).toBeGreaterThan(0);
      expect(lifetime).toBeLessThanOrEqual(
        APPLE_CLIENT_SECRET_MAX_LIFETIME_SECONDS,
      );
    });

    it('rejects an id_token whose nonce does not match', async () => {
      const token = await idToken({ nonce: 'other-nonce' });
      mockFetch([
        { url: JWKS_URI, body: idTokenKey.jwks },
        { url: TOKEN_URL, body: { access_token: 'access', id_token: token } },
      ]);

      await expectAppException(
        strategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
          nonce: 'nonce-value',
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('fails when the token response carries no id_token', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      mockFetch([{ url: TOKEN_URL, body: { access_token: 'access' } }]);

      await expectAppException(
        strategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_CODE_INVALID,
      );
      expect(warn.mock.calls.flat().join(' ')).toContain('reason=no_id_token');
      warn.mockRestore();
    });

    it('fails when the sign-in key cannot be read', async () => {
      mockFetch([{ url: TOKEN_URL, body: { access_token: 'access' } }]);

      await expectAppException(
        strategy({ PRIVATE_KEY: 'not-a-pem' }).exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_CODE_INVALID,
      );
    });
  });

  describe('fetchProfile', () => {
    it('reads the name from the first authorization payload', async () => {
      const token = await idToken();
      mockFetch([{ url: JWKS_URI, body: idTokenKey.jwks }]);

      const profile = await strategy().fetchProfile(
        { accessToken: 'access', idToken: token },
        { user: USER_PAYLOAD },
      );

      expect(profile).toEqual({
        providerId: SUBJECT,
        email: 'ada@privaterelay.appleid.com',
        emailVerified: true,
        name: 'Ada Lovelace',
      });
    });

    it('falls back to the email on later logins, when Apple sends no name', async () => {
      const token = await idToken();
      mockFetch([{ url: JWKS_URI, body: idTokenKey.jwks }]);

      const profile = await strategy().fetchProfile({
        accessToken: 'access',
        idToken: token,
      });

      expect(profile.name).toBe('ada@privaterelay.appleid.com');
    });

    it('accepts email_verified as a boolean too', async () => {
      const token = await idToken({ email_verified: true });
      mockFetch([{ url: JWKS_URI, body: idTokenKey.jwks }]);

      const profile = await strategy().fetchProfile({
        accessToken: 'access',
        idToken: token,
      });

      expect(profile.emailVerified).toBe(true);
    });

    it('marks the email unverified when Apple says so', async () => {
      const token = await idToken({ email_verified: 'false' });
      mockFetch([{ url: JWKS_URI, body: idTokenKey.jwks }]);

      const profile = await strategy().fetchProfile({
        accessToken: 'access',
        idToken: token,
      });

      expect(profile.emailVerified).toBe(false);
    });

    it('fails when the id_token carries no email', async () => {
      const token = await idToken({ email: undefined });
      mockFetch([{ url: JWKS_URI, body: idTokenKey.jwks }]);

      await expectAppException(
        strategy().fetchProfile({ accessToken: 'access', idToken: token }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });
  });
});
