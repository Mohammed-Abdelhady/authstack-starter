import { DiscordOAuthStrategy } from './discord-oauth.strategy';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  configFor,
  expectAppException,
  mockFetch,
} from './oauth-strategy.harness-spec';

const CLIENT_ID = 'discord-client-id';
const AUTH_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';
const REDIRECT_URI = 'https://api.example.com/api/auth/oauth/discord/callback';

function strategy(): DiscordOAuthStrategy {
  return new DiscordOAuthStrategy(
    configFor('discord', {
      clientId: CLIENT_ID,
      clientSecret: 'discord-client-secret',
    }),
  );
}

function discordUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '80351110224678912',
    username: 'nelly',
    global_name: 'Nelly',
    email: 'nelly@discord.com',
    verified: true,
    avatar: '8342729096ea3675442027381ff50dfe',
    ...overrides,
  };
}

describe('DiscordOAuthStrategy', () => {
  describe('getAuthorizationUrl', () => {
    it('requests identify and email with a PKCE challenge', () => {
      const url = new URL(
        strategy().getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
          codeChallenge: 'challenge',
        }),
      );

      expect(url.origin + url.pathname).toBe(AUTH_URL);
      expect(url.searchParams.get('scope')).toBe('identify email');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('state-value');
      expect(url.searchParams.get('code_challenge')).toBe('challenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('omits the challenge when PKCE was skipped', () => {
      const url = new URL(
        strategy().getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
        }),
      );

      expect(url.searchParams.has('code_challenge')).toBe(false);
    });
  });

  describe('exchangeCode', () => {
    it('sends the verifier in the form body', async () => {
      const fetchMock = mockFetch([
        {
          url: TOKEN_URL,
          body: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 604800,
            scope: 'identify email',
            token_type: 'Bearer',
          },
        },
      ]);

      const tokens = await strategy().exchangeCode({
        code: 'auth-code',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier',
      });

      expect(tokens).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 604800,
        scope: 'identify email',
        tokenType: 'Bearer',
      });

      const call = fetchMock.callTo(TOKEN_URL);
      expect(call.body.client_secret).toBe('discord-client-secret');
      expect(call.body.code_verifier).toBe('verifier');
      expect(call.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
    });

    it('reports a rejected code as OAUTH_CODE_INVALID', async () => {
      mockFetch([
        {
          url: TOKEN_URL,
          body: {
            error: 'invalid_grant',
            error_description: 'Invalid "code" in request.',
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

    it('maps a token endpoint timeout to OAUTH_AUTHENTICATION_FAILED', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new Error('The operation timed out'), {
          name: 'TimeoutError',
        }),
      );

      await expectAppException(
        strategy().exchangeCode({
          code: 'auth-code',
          redirectUri: REDIRECT_URI,
        }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });
  });

  describe('fetchProfile', () => {
    it('builds the CDN avatar URL and reads the verified flag', async () => {
      const fetchMock = mockFetch([{ url: USER_URL, body: discordUser() }]);

      const profile = await strategy().fetchProfile({
        accessToken: 'access-token',
      });

      expect(profile).toEqual({
        providerId: '80351110224678912',
        email: 'nelly@discord.com',
        emailVerified: true,
        name: 'Nelly',
        avatarUrl:
          'https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png',
      });
      expect(fetchMock.callTo(USER_URL).headers.Authorization).toBe(
        'Bearer access-token',
      );
    });

    it('falls back to the username when there is no display name', async () => {
      mockFetch([{ url: USER_URL, body: discordUser({ global_name: null }) }]);

      const profile = await strategy().fetchProfile({
        accessToken: 'access-token',
      });

      expect(profile.name).toBe('nelly');
    });

    it('marks an unverified address as unverified', async () => {
      mockFetch([{ url: USER_URL, body: discordUser({ verified: false }) }]);

      const profile = await strategy().fetchProfile({
        accessToken: 'access-token',
      });

      expect(profile.emailVerified).toBe(false);
    });

    it('fails when the account has no email', async () => {
      mockFetch([{ url: USER_URL, body: discordUser({ email: null }) }]);

      await expectAppException(
        strategy().fetchProfile({ accessToken: 'access-token' }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });

    it('maps a profile request timeout to OAUTH_AUTHENTICATION_FAILED', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), {
          name: 'AbortError',
        }),
      );

      await expectAppException(
        strategy().fetchProfile({ accessToken: 'access-token' }),
        ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      );
    });
  });

  it('is disabled without credentials', () => {
    const withoutSecret = new DiscordOAuthStrategy(
      configFor('discord', { enabled: false, clientId: CLIENT_ID }),
    );

    expect(withoutSecret.isEnabled()).toBe(false);
    expect(strategy().isEnabled()).toBe(true);
  });
});
