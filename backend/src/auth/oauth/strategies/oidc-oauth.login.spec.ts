import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  SigningKey,
  createSigningKey,
  expectAppException,
  mockFetch,
  signIdToken,
} from './oauth-strategy.harness-spec';
import {
  ISSUER,
  JWKS_URI,
  OidcClaims,
  REDIRECT_URI,
  TOKEN_URL,
  USERINFO_URL,
  baseClaims,
  manualStrategy,
} from './oidc-oauth.harness-spec';

/** Login side of the generic provider: code exchange and profile. */
describe('OidcOAuthStrategy login', () => {
  let key: SigningKey;

  beforeAll(async () => {
    key = await createSigningKey();
  });

  describe('exchangeCode', () => {
    it('posts the code and verifies the id_token nonce', async () => {
      const idToken = await signIdToken({
        key,
        claims: { ...baseClaims(), nonce: 'nonce-value' },
      });
      const fetchMock = mockFetch([
        { url: JWKS_URI, body: key.jwks },
        {
          url: TOKEN_URL,
          body: { access_token: 'access-token', id_token: idToken },
        },
      ]);

      const tokens = await manualStrategy().exchangeCode({
        code: 'auth-code',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier',
        nonce: 'nonce-value',
      });

      expect(tokens.accessToken).toBe('access-token');

      const tokenCall = fetchMock.callTo(TOKEN_URL);
      expect(tokenCall.body.code_verifier).toBe('verifier');
      expect(tokenCall.body.client_secret).toBe('oidc-client-secret');
    });

    it('rejects an id_token whose nonce does not match', async () => {
      const idToken = await signIdToken({
        key,
        claims: { ...baseClaims(), nonce: 'other-nonce' },
      });
      mockFetch([
        { url: JWKS_URI, body: key.jwks },
        {
          url: TOKEN_URL,
          body: { access_token: 'access-token', id_token: idToken },
        },
      ]);

      await expectAppException(
        manualStrategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
          nonce: 'nonce-value',
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('rejects an id_token from another issuer', async () => {
      const idToken = await signIdToken({
        key,
        claims: baseClaims({ iss: 'https://evil.example.com' }),
      });
      mockFetch([
        { url: JWKS_URI, body: key.jwks },
        {
          url: TOKEN_URL,
          body: { access_token: 'access-token', id_token: idToken },
        },
      ]);

      await expectAppException(
        manualStrategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('rejects an id_token signed by an unknown key', async () => {
      const otherKey = await createSigningKey();
      const idToken = await signIdToken({
        key: otherKey,
        claims: baseClaims(),
      });
      mockFetch([
        { url: JWKS_URI, body: key.jwks },
        {
          url: TOKEN_URL,
          body: { access_token: 'access-token', id_token: idToken },
        },
      ]);

      await expectAppException(
        manualStrategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('reports a rejected code as OAUTH_CODE_INVALID', async () => {
      mockFetch([
        {
          url: TOKEN_URL,
          body: {
            error: 'invalid_grant',
            error_description: 'code already used',
          },
        },
      ]);

      await expectAppException(
        manualStrategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_CODE_INVALID,
      );
    });
  });

  describe('fetchProfile', () => {
    async function profileWith(claims: OidcClaims, userInfo: unknown) {
      const idToken = await signIdToken({ key, claims });
      mockFetch([
        { url: JWKS_URI, body: key.jwks },
        { url: USERINFO_URL, body: userInfo },
      ]);

      return manualStrategy().fetchProfile({
        accessToken: 'access-token',
        idToken,
      });
    }

    it('uses sub as the provider id and reads userinfo', async () => {
      const profile = await profileWith(baseClaims(), {
        sub: 'subject-id',
        name: 'Test User',
        email: 'user@example.com',
        email_verified: true,
        picture: `${ISSUER}/avatar.png`,
      });

      expect(profile).toEqual({
        providerId: 'subject-id',
        email: 'user@example.com',
        emailVerified: true,
        name: 'Test User',
        avatarUrl: `${ISSUER}/avatar.png`,
      });
    });

    it('refuses userinfo answered for another subject', async () => {
      await expectAppException(
        profileWith(baseClaims(), {
          sub: 'someone-else',
          email: 'user@example.com',
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('passes an unverified address through as unverified', async () => {
      const profile = await profileWith(baseClaims({ email_verified: false }), {
        sub: 'subject-id',
        email: 'user@example.com',
        email_verified: false,
      });

      expect(profile.emailVerified).toBe(false);
    });

    it('fails when no email is available', async () => {
      await expectAppException(
        profileWith(baseClaims({ email: undefined }), { sub: 'subject-id' }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });
  });
});
