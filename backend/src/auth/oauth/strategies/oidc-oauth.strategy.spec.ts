import { OidcOAuthStrategy } from './oidc-oauth.strategy';
import { Logger } from '@nestjs/common';
import { configFor, mockFetch } from './oauth-strategy.harness-spec';
import {
  AUTH_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  DISCOVERY_URL,
  ISSUER,
  REDIRECT_URI,
  discoveringStrategy,
  discoveryDocument,
  manualStrategy,
} from './oidc-oauth.harness-spec';

/** Configuration side of the generic provider: identity, discovery, authorize. */
describe('OidcOAuthStrategy setup', () => {
  describe('identity', () => {
    it('refuses an id that would shadow a built-in provider', () => {
      expect(() => manualStrategy({ PROVIDER_ID: 'google' })).toThrow(
        'is the id of a built-in provider',
      );
    });

    it('refuses an id that would not fit in a route segment', () => {
      expect(() => manualStrategy({ PROVIDER_ID: 'Company SSO' })).toThrow(
        'lowercase letters, digits and dashes',
      );
    });
  });

  describe('onModuleInit', () => {
    it.each([
      {
        status: 503,
        body: { error: 'secret@example.com' },
        reason: 'http_status',
        statusFact: 'status=503',
      },
      {
        status: 200,
        body: discoveryDocument({
          issuer: 'https://secret@example.com/hunter2',
        }),
        reason: 'issuer_mismatch',
        statusFact: undefined,
      },
    ])(
      'logs discovery $reason by safe name, reason and status',
      async ({ status, body, reason, statusFact }) => {
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => {});
        try {
          mockFetch([{ url: DISCOVERY_URL, status, body }]);
          const provider = discoveringStrategy();
          await provider.onModuleInit();
          expect(provider.isEnabled()).toBe(false);
          const logged = warn.mock.calls.flat().join(' ');
          expect(logged).toContain('name=DiscoveryFailure');
          expect(logged).toContain(`reason=${reason}`);
          if (statusFact) expect(logged).toContain(statusFact);
          expect(logged).not.toContain('secret@example.com');
          expect(logged).not.toContain('hunter2');
        } finally {
          warn.mockRestore();
        }
      },
    );

    it('labels invalid discovery metadata as unexpected, never network', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      try {
        mockFetch([
          {
            url: DISCOVERY_URL,
            body: {
              ...discoveryDocument(),
              code_challenge_methods_supported: {},
            },
          },
        ]);
        const provider = discoveringStrategy();
        await provider.onModuleInit();
        expect(provider.isEnabled()).toBe(false);
        const line = warn.mock.calls.flat().join(' ');
        expect(line).toContain('name=TypeError reason=unexpected');
        expect(line).not.toContain('reason=network');
        expect(line).not.toContain('secret@example.com');
      } finally {
        warn.mockRestore();
      }
    });

    it('reads the discovery document once and turns PKCE on', async () => {
      const fetchMock = mockFetch([
        { url: DISCOVERY_URL, body: discoveryDocument() },
      ]);
      const provider = discoveringStrategy();

      expect(provider.isEnabled()).toBe(false);
      await provider.onModuleInit();

      expect(provider.isEnabled()).toBe(true);
      expect(provider.supportsPkce).toBe(true);
      expect(fetchMock.calls).toHaveLength(1);
    });

    it('leaves PKCE off when the issuer does not advertise S256', async () => {
      mockFetch([
        {
          url: DISCOVERY_URL,
          body: discoveryDocument({
            code_challenge_methods_supported: undefined,
          }),
        },
      ]);
      const provider = discoveringStrategy();
      await provider.onModuleInit();

      expect(provider.supportsPkce).toBe(false);
    });

    it('stays disabled and does not throw when the issuer is unreachable', async () => {
      mockFetch([]);
      const provider = discoveringStrategy();

      await expect(provider.onModuleInit()).resolves.toBeUndefined();
      expect(provider.isEnabled()).toBe(false);
    });

    it('stays disabled when no issuer is configured', async () => {
      const provider = new OidcOAuthStrategy(
        configFor('oidc', {
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
        }),
      );
      mockFetch([]);

      await provider.onModuleInit();

      expect(provider.isEnabled()).toBe(false);
    });

    it('skips discovery when every endpoint is set by hand', async () => {
      const fetchMock = mockFetch([]);
      const provider = manualStrategy();

      await provider.onModuleInit();

      expect(provider.isEnabled()).toBe(true);
      expect(provider.supportsPkce).toBe(false);
      expect(fetchMock.calls).toHaveLength(0);
    });

    it('does not reach for a document without credentials', async () => {
      const fetchMock = mockFetch([]);
      const provider = new OidcOAuthStrategy(
        configFor('oidc', { enabled: false, extra: { ISSUER } }),
      );

      await provider.onModuleInit();

      expect(provider.isEnabled()).toBe(false);
      expect(fetchMock.calls).toHaveLength(0);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('uses the resolved endpoint and the configured scopes', () => {
      const url = new URL(
        manualStrategy({ SCOPES: 'openid email groups' }).getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
          codeChallenge: 'challenge',
          nonce: 'nonce-value',
        }),
      );

      expect(url.origin + url.pathname).toBe(AUTH_URL);
      expect(url.searchParams.get('scope')).toBe('openid email groups');
      expect(url.searchParams.get('nonce')).toBe('nonce-value');
      expect(url.searchParams.get('code_challenge')).toBe('challenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('defaults to the OIDC scopes', () => {
      const url = new URL(
        manualStrategy().getAuthorizationUrl({
          state: 'state-value',
          redirectUri: REDIRECT_URI,
        }),
      );

      expect(url.searchParams.get('scope')).toBe('openid profile email');
    });
  });
});
