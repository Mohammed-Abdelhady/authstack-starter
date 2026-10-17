import type { JWTPayload } from 'jose';
import { GitLabOAuthStrategy } from './gitlab-oauth.strategy';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  SigningKey,
  configFor,
  createSigningKey,
  expectAppException,
  mockFetch,
  signIdToken,
} from './oauth-strategy.harness-spec';

const CLIENT_ID = 'gitlab-client-id';
const HOSTED = 'https://gitlab.com';
const SELF_MANAGED = 'https://git.example.com';
const REDIRECT_URI = 'https://api.example.com/api/auth/oauth/gitlab/callback';

interface Claims extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  nonce?: string;
  iss?: string;
  aud?: string;
}

function baseClaims(overrides: Partial<Claims> = {}): Claims {
  return {
    sub: '42',
    email: 'user@example.com',
    email_verified: true,
    name: 'Test User',
    iss: HOSTED,
    aud: CLIENT_ID,
    ...overrides,
  };
}

function strategy(baseUrl?: string): GitLabOAuthStrategy {
  return new GitLabOAuthStrategy(
    configFor('gitlab', {
      clientId: CLIENT_ID,
      clientSecret: 'gitlab-client-secret',
      extra: baseUrl ? { BASE_URL: baseUrl } : {},
    }),
  );
}

describe('GitLabOAuthStrategy', () => {
  let key: SigningKey;

  beforeAll(async () => {
    key = await createSigningKey();
  });

  describe('getAuthorizationUrl', () => {
    it('asks gitlab.com for the OIDC scopes with PKCE and a nonce', () => {
      const url = new URL(
        strategy().getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
          codeChallenge: 'challenge',
          nonce: 'nonce-value',
        }),
      );

      expect(url.origin + url.pathname).toBe(`${HOSTED}/oauth/authorize`);
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('scope')).toBe(
        'openid profile email read_user',
      );
      expect(url.searchParams.get('code_challenge')).toBe('challenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('nonce')).toBe('nonce-value');
    });

    it('points at a self-managed instance and drops its trailing slash', () => {
      const url = strategy(`${SELF_MANAGED}/`).getAuthorizationUrl({
        state: 'state-value',
        redirectUri: REDIRECT_URI,
      });

      expect(url.startsWith(`${SELF_MANAGED}/oauth/authorize?`)).toBe(true);
    });
  });

  describe('exchangeCode', () => {
    it('posts the code and verifies the id_token nonce', async () => {
      const idToken = await signIdToken({
        key,
        claims: { ...baseClaims(), nonce: 'nonce-value' },
      });
      const fetchMock = mockFetch([
        { url: `${HOSTED}/oauth/discovery/keys`, body: key.jwks },
        {
          url: `${HOSTED}/oauth/token`,
          body: { access_token: 'access-token', id_token: idToken },
        },
      ]);

      const tokens = await strategy().exchangeCode({
        code: 'auth-code',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier',
        nonce: 'nonce-value',
      });

      expect(tokens.accessToken).toBe('access-token');
      expect(tokens.idToken).toBe(idToken);

      const tokenCall = fetchMock.callTo(`${HOSTED}/oauth/token`);
      expect(tokenCall.method).toBe('POST');
      expect(tokenCall.body.code_verifier).toBe('verifier');
      expect(tokenCall.body.client_secret).toBe('gitlab-client-secret');
    });

    it('rejects an id_token whose nonce does not match', async () => {
      const idToken = await signIdToken({
        key,
        claims: { ...baseClaims(), nonce: 'other-nonce' },
      });
      mockFetch([
        { url: `${HOSTED}/oauth/discovery/keys`, body: key.jwks },
        {
          url: `${HOSTED}/oauth/token`,
          body: { access_token: 'access-token', id_token: idToken },
        },
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

    it('rejects an id_token signed by an unknown key', async () => {
      const otherKey = await createSigningKey();
      const idToken = await signIdToken({
        key: otherKey,
        claims: baseClaims(),
      });
      mockFetch([
        { url: `${HOSTED}/oauth/discovery/keys`, body: key.jwks },
        {
          url: `${HOSTED}/oauth/token`,
          body: { access_token: 'access-token', id_token: idToken },
        },
      ]);

      await expectAppException(
        strategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('refuses a gitlab.com token on a self-managed instance', async () => {
      const idToken = await signIdToken({ key, claims: baseClaims() });
      mockFetch([
        { url: `${SELF_MANAGED}/oauth/discovery/keys`, body: key.jwks },
        {
          url: `${SELF_MANAGED}/oauth/token`,
          body: { access_token: 'access-token', id_token: idToken },
        },
      ]);

      await expectAppException(
        strategy(SELF_MANAGED).exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('reports a rejected code as OAUTH_CODE_INVALID', async () => {
      mockFetch([
        {
          url: `${HOSTED}/oauth/token`,
          body: {
            error: 'invalid_grant',
            error_description: 'code is expired',
          },
        },
      ]);

      await expectAppException(
        strategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_CODE_INVALID,
      );
    });
  });

  describe('fetchProfile', () => {
    async function profileWith(claims: Claims, userInfo: unknown) {
      const idToken = await signIdToken({ key, claims });
      mockFetch([
        { url: `${HOSTED}/oauth/discovery/keys`, body: key.jwks },
        { url: `${HOSTED}/oauth/userinfo`, body: userInfo },
      ]);

      return strategy().fetchProfile({
        accessToken: 'access-token',
        idToken,
      });
    }

    it('uses sub as the provider id and reads userinfo', async () => {
      const profile = await profileWith(baseClaims(), {
        sub: '42',
        name: 'Test User',
        email: 'user@example.com',
        email_verified: true,
        picture: 'https://gitlab.com/uploads/avatar.png',
      });

      expect(profile).toEqual({
        providerId: '42',
        email: 'user@example.com',
        emailVerified: true,
        name: 'Test User',
        avatarUrl: 'https://gitlab.com/uploads/avatar.png',
      });
    });

    it('passes an unverified address through as unverified', async () => {
      const profile = await profileWith(baseClaims({ email_verified: false }), {
        sub: '42',
        email: 'user@example.com',
        email_verified: false,
      });

      expect(profile.emailVerified).toBe(false);
    });

    it('fails when no email is available', async () => {
      await expectAppException(
        profileWith(baseClaims({ email: undefined }), { sub: '42' }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });
  });
});
