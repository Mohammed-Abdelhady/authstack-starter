import type { JWTPayload } from 'jose';
import { MicrosoftOAuthStrategy } from './microsoft-oauth.strategy';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  SigningKey,
  configFor,
  createSigningKey,
  expectAppException,
  mockFetch,
  signIdToken,
} from './oauth-strategy.harness-spec';
import { resetJwksCache } from '../utils/id-token.util';

const CLIENT_ID = 'microsoft-client-id';
const TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const AUTHORITY = 'https://login.microsoftonline.com';
const USERINFO_URL = 'https://graph.microsoft.com/oidc/userinfo';
const REDIRECT_URI =
  'https://api.example.com/api/auth/oauth/microsoft/callback';

interface Claims extends JWTPayload {
  sub: string;
  oid?: string;
  email?: string;
  preferred_username?: string;
  xms_edov?: boolean;
  name?: string;
  nonce?: string;
  tid?: string;
  iss?: string;
  aud?: string;
}

function baseClaims(overrides: Partial<Claims> = {}): Claims {
  return {
    sub: 'subject-id',
    oid: 'object-id',
    email: 'user@contoso.com',
    preferred_username: 'user@contoso.com',
    name: 'Test User',
    tid: TENANT_ID,
    iss: `${AUTHORITY}/${TENANT_ID}/v2.0`,
    aud: CLIENT_ID,
    ...overrides,
  };
}

function strategy(tenant?: string): MicrosoftOAuthStrategy {
  return new MicrosoftOAuthStrategy(
    configFor('microsoft', {
      clientId: CLIENT_ID,
      clientSecret: 'microsoft-client-secret',
      extra: tenant ? { TENANT: tenant } : {},
    }),
  );
}

describe('MicrosoftOAuthStrategy', () => {
  let key: SigningKey;

  beforeAll(async () => {
    key = await createSigningKey();
  });

  describe('getAuthorizationUrl', () => {
    it('targets the common tenant with PKCE and a nonce', () => {
      const url = new URL(
        strategy().getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
          codeChallenge: 'challenge',
          nonce: 'nonce-value',
        }),
      );

      expect(url.origin + url.pathname).toBe(
        `${AUTHORITY}/common/oauth2/v2.0/authorize`,
      );
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('scope')).toBe('openid profile email');
      expect(url.searchParams.get('response_mode')).toBe('query');
      expect(url.searchParams.get('code_challenge')).toBe('challenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('nonce')).toBe('nonce-value');
    });

    it('uses the configured tenant', () => {
      const url = strategy(TENANT_ID).getAuthorizationUrl({
        state: 'state-value',
        redirectUri: REDIRECT_URI,
      });

      expect(
        url.startsWith(`${AUTHORITY}/${TENANT_ID}/oauth2/v2.0/authorize`),
      ).toBe(true);
    });
  });

  describe('exchangeCode', () => {
    it('posts the code and verifies the id_token nonce', async () => {
      const idToken = await signIdToken({
        key,
        claims: { ...baseClaims(), nonce: 'nonce-value' },
      });
      const fetchMock = mockFetch([
        {
          url: `${AUTHORITY}/common/discovery/v2.0/keys`,
          body: key.jwks,
        },
        {
          url: `${AUTHORITY}/common/oauth2/v2.0/token`,
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

      const tokenCall = fetchMock.callTo(
        `${AUTHORITY}/common/oauth2/v2.0/token`,
      );
      expect(tokenCall.method).toBe('POST');
      expect(tokenCall.body.code_verifier).toBe('verifier');
      expect(tokenCall.body.grant_type).toBe('authorization_code');
    });

    it('maps a JWKS timeout to OAUTH_AUTHENTICATION_FAILED', async () => {
      resetJwksCache();
      const idToken = await signIdToken({ key, claims: baseClaims() });
      global.fetch = jest.fn((input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes('/token')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: 'access-token',
                id_token: idToken,
              }),
          } as Response);
        }
        return Promise.reject(
          Object.assign(new Error('The operation timed out'), {
            name: 'TimeoutError',
          }),
        );
      });

      await expectAppException(
        strategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('rejects an id_token whose nonce does not match', async () => {
      const idToken = await signIdToken({
        key,
        claims: { ...baseClaims(), nonce: 'other-nonce' },
      });
      mockFetch([
        { url: `${AUTHORITY}/common/discovery/v2.0/keys`, body: key.jwks },
        {
          url: `${AUTHORITY}/common/oauth2/v2.0/token`,
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
        { url: `${AUTHORITY}/common/discovery/v2.0/keys`, body: key.jwks },
        {
          url: `${AUTHORITY}/common/oauth2/v2.0/token`,
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

    it('rejects an issuer that does not match the tid claim', async () => {
      const idToken = await signIdToken({
        key,
        claims: baseClaims({ iss: `${AUTHORITY}/some-other-tenant/v2.0` }),
      });
      mockFetch([
        { url: `${AUTHORITY}/common/discovery/v2.0/keys`, body: key.jwks },
        {
          url: `${AUTHORITY}/common/oauth2/v2.0/token`,
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

    it('reports a rejected code as OAUTH_CODE_INVALID', async () => {
      mockFetch([
        {
          url: `${AUTHORITY}/common/oauth2/v2.0/token`,
          body: { error: 'invalid_grant', error_description: 'code expired' },
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
        { url: `${AUTHORITY}/common/discovery/v2.0/keys`, body: key.jwks },
        { url: USERINFO_URL, body: userInfo },
      ]);

      return strategy().fetchProfile({
        accessToken: 'access-token',
        idToken,
      });
    }

    it('uses oid as the provider id and trusts xms_edov', async () => {
      const profile = await profileWith(baseClaims({ xms_edov: true }), {
        sub: 'subject-id',
        email: 'user@contoso.com',
        name: 'Test User',
      });

      expect(profile).toEqual({
        providerId: 'object-id',
        email: 'user@contoso.com',
        emailVerified: true,
        name: 'Test User',
      });
    });

    it('falls back to sub when the token carries no oid', async () => {
      const profile = await profileWith(baseClaims({ oid: undefined }), {
        sub: 'subject-id',
        email: 'user@contoso.com',
      });

      expect(profile.providerId).toBe('subject-id');
    });

    it('treats the email as verified when it is the sign-in name', async () => {
      const profile = await profileWith(baseClaims(), {
        sub: 'subject-id',
        email: 'user@contoso.com',
      });

      expect(profile.emailVerified).toBe(true);
    });

    it('marks the email unverified when nothing vouches for it', async () => {
      const profile = await profileWith(
        baseClaims({ preferred_username: 'contoso\\user' }),
        { sub: 'subject-id', email: 'user@contoso.com' },
      );

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
