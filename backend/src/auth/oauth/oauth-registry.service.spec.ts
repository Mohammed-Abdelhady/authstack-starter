import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { OAuthRegistryService } from './oauth-registry.service';
import { OAuthProviderStrategy } from './oauth-provider.interface';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';

function strategy(
  id: string,
  displayName: string,
  enabled: boolean,
): OAuthProviderStrategy {
  return {
    id,
    displayName,
    envPrefix: `OAUTH_${id.toUpperCase()}`,
    supportsPkce: false,
    usesOidc: false,
    emailAlwaysVerified: true,
    autoLinksByEmail: true,
    callbackMethod: 'GET',
    isEnabled: () => enabled,
    getAuthorizationUrl: () => `https://provider.test/${id}`,
    exchangeCode: () => Promise.resolve({ accessToken: 'token' }),
    fetchProfile: () =>
      Promise.resolve({
        providerId: '1',
        email: 'user@example.com',
        emailVerified: true,
        name: 'User',
      }),
  };
}

function registryWith(
  strategies: OAuthProviderStrategy[],
  config: Record<string, unknown> = {},
): OAuthRegistryService {
  return new OAuthRegistryService(strategies, new ConfigService(config));
}

describe('OAuthRegistryService', () => {
  const google = strategy('google', 'Google', true);
  const github = strategy('github', 'GitHub', true);
  const facebook = strategy('facebook', 'Facebook', false);

  it('resolves a registered strategy by id', () => {
    const registry = registryWith([google, github, facebook]);

    expect(registry.get('github')).toBe(github);
    expect(registry.has('github')).toBe(true);
    expect(registry.getIds()).toEqual(['google', 'github', 'facebook']);
  });

  it('rejects an unknown provider with OAUTH_PROVIDER_UNKNOWN', () => {
    const registry = registryWith([google]);

    expect.assertions(3);
    try {
      registry.get('myspace');
    } catch (error) {
      const exception = error as AppException;
      expect(exception).toBeInstanceOf(AppException);
      expect(exception.getCode()).toBe(ErrorCode.OAUTH_PROVIDER_UNKNOWN);
      expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });

  it('rejects a registered but unconfigured provider with OAUTH_NOT_CONFIGURED', () => {
    const registry = registryWith([google, facebook]);

    expect.assertions(3);
    try {
      registry.getEnabled('facebook');
    } catch (error) {
      const exception = error as AppException;
      expect(exception.getCode()).toBe(ErrorCode.OAUTH_NOT_CONFIGURED);
      expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(exception.getDetails()).toEqual({ provider: 'facebook' });
    }
  });

  it('lists only enabled providers as id and display name', () => {
    const registry = registryWith([google, github, facebook]);

    expect(registry.listEnabled()).toEqual([
      { id: 'google', displayName: 'Google' },
      { id: 'github', displayName: 'GitHub' },
    ]);
    expect(registry.isEnabled('facebook')).toBe(false);
  });

  it('derives the callback URL from the callback base URL', () => {
    const registry = registryWith([google], {
      'oauth.callbackBaseUrl': 'http://localhost:5000/api/auth/oauth',
    });

    expect(registry.getCallbackUrl('google')).toBe(
      'http://localhost:5000/api/auth/oauth/google/callback',
    );
  });

  it('prefers a per-provider callback URL override', () => {
    const registry = registryWith([google], {
      'oauth.callbackBaseUrl': 'http://localhost:5000/api/auth/oauth',
      'oauth.providers.google': {
        enabled: true,
        callbackUrl: 'https://api.example.com/oauth/google',
      },
    });

    expect(registry.getCallbackUrl('google')).toBe(
      'https://api.example.com/oauth/google',
    );
  });
});
