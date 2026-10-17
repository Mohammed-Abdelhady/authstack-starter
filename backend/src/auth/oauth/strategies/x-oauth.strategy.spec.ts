import { XOAuthStrategy } from './x-oauth.strategy';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  configFor,
  expectAppException,
  mockFetch,
} from './oauth-strategy.harness-spec';

const CLIENT_ID = 'x-client-id';
const CLIENT_SECRET = 'x-client-secret';
const AUTH_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const USER_URL = 'https://api.x.com/2/users/me';
const REDIRECT_URI = 'https://api.example.com/api/auth/oauth/x/callback';

function strategy(): XOAuthStrategy {
  return new XOAuthStrategy(
    configFor('x', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  );
}

describe('XOAuthStrategy', () => {
  describe('getAuthorizationUrl', () => {
    it('sends the code challenge and the email scope', () => {
      const url = new URL(
        strategy().getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
          codeChallenge: 'challenge',
        }),
      );

      expect(url.origin + url.pathname).toBe(AUTH_URL);
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('scope')).toBe(
        'tweet.read users.read users.email offline.access',
      );
      expect(url.searchParams.get('code_challenge')).toBe('challenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('refuses to start without a code challenge', () => {
      expect(() =>
        strategy().getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
        }),
      ).toThrow('X requires PKCE and the flow carried no code verifier');
    });
  });

  describe('exchangeCode', () => {
    it('authenticates the client with HTTP Basic and sends the verifier', async () => {
      const fetchMock = mockFetch([
        {
          url: TOKEN_URL,
          body: { access_token: 'access-token', token_type: 'bearer' },
        },
      ]);

      const tokens = await strategy().exchangeCode({
        code: 'auth-code',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier',
      });

      expect(tokens.accessToken).toBe('access-token');

      const tokenCall = fetchMock.callTo(TOKEN_URL);
      expect(tokenCall.method).toBe('POST');
      expect(tokenCall.body.code_verifier).toBe('verifier');
      // Credentials travel in the header only.
      expect(tokenCall.body.client_id).toBeUndefined();
      expect(tokenCall.body.client_secret).toBeUndefined();

      const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
        'base64',
      );
      expect(tokenCall.headers.Authorization).toBe(`Basic ${basic}`);
    });

    it('refuses to exchange without a verifier', async () => {
      mockFetch([]);

      await expectAppException(
        strategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_STATE_INVALID,
      );
    });

    it('reports an expired code as OAUTH_CODE_INVALID', async () => {
      // Codes live for 30 seconds, so a slow callback lands here.
      mockFetch([
        {
          url: TOKEN_URL,
          body: {
            error: 'invalid_request',
            error_description:
              'Value passed for the authorization code was invalid.',
          },
        },
      ]);

      await expectAppException(
        strategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
          codeVerifier: 'verifier',
        }),
        ErrorCode.OAUTH_CODE_INVALID,
      );
    });
  });

  describe('fetchProfile', () => {
    function profileWith(body: unknown) {
      mockFetch([{ url: USER_URL, body }]);
      return strategy().fetchProfile({ accessToken: 'access-token' });
    }

    it('reads the user out of the data wrapper', async () => {
      const fetchMock = mockFetch([
        {
          url: USER_URL,
          body: {
            data: {
              id: '2244994945',
              name: 'Test User',
              username: 'testuser',
              confirmed_email: 'user@example.com',
              profile_image_url: 'https://pbs.twimg.com/profile.jpg',
            },
          },
        },
      ]);

      const profile = await strategy().fetchProfile({
        accessToken: 'access-token',
      });

      expect(profile).toEqual({
        providerId: '2244994945',
        email: 'user@example.com',
        emailVerified: true,
        name: 'Test User',
        avatarUrl: 'https://pbs.twimg.com/profile.jpg',
      });

      const userCall = fetchMock.callTo(USER_URL);
      expect(userCall.url).toContain(
        'user.fields=confirmed_email%2Cprofile_image_url',
      );
      expect(userCall.headers.Authorization).toBe('Bearer access-token');
    });

    it('refuses an account with no confirmed address', async () => {
      const exception = await expectAppException(
        profileWith({ data: { id: '2244994945', username: 'testuser' } }),
        ErrorCode.OAUTH_EMAIL_UNVERIFIED,
      );

      expect(exception.getStatus()).toBe(403);
    });

    it('reports a response that carries no user', async () => {
      await expectAppException(
        profileWith({ title: 'Unauthorized', detail: 'Unauthorized' }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });
  });
});
