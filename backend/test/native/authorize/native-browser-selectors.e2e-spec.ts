// feature:oauth-core:start
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import type { OAuthProviderStrategy } from '../../../src/auth/oauth/oauth-provider.interface';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import { SEED_USER } from '../../constants/seed-users';
import { createNativeApplication } from '../../utils/native/native-authorize.fixtures';
import { nativeAuthorizeQuery } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

let providerEnabled = true;
const PROVIDER: OAuthProviderStrategy = {
  id: 'team-sso',
  displayName: 'Team SSO',
  envPrefix: 'FIXTURE',
  supportsPkce: true,
  usesOidc: false,
  emailAlwaysVerified: true,
  autoLinksByEmail: false,
  callbackMethod: 'GET',
  isEnabled: () => providerEnabled,
  getAuthorizationUrl: () => 'https://provider.example/authorize',
  exchangeCode: () =>
    Promise.reject(new Error('No provider exchange in this fixture')),
  fetchProfile: () =>
    Promise.reject(new Error('No provider profile in this fixture')),
};

describe('native browser selection at the HTTP entry', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      browserStrategy: PROVIDER,
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    providerEnabled = true;
    e2e.app.get(ConfigService).set('auth.passwordEnabled', true);
    await e2e.reset();
    await createNativeApplication(e2e);
  });

  function authorize(selectors: Record<string, unknown> = {}) {
    return request(e2e.httpServer)
      .get('/api/oauth/authorize')
      .query({ ...nativeAuthorizeQuery('a'.repeat(43)), ...selectors })
      .set('Accept-Language', 'en')
      .redirects(0);
  }

  it('retains the selected provider with an existing browser cookie and never issues a native token', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const response = await browser
      .get('/api/oauth/authorize')
      .query({
        ...nativeAuthorizeQuery('a'.repeat(43)),
        provider_id: 'team-sso',
      })
      .redirects(0)
      .expect(302);
    const target = new URL(String(response.headers.location));
    expect(target.searchParams.get('provider_id')).toBe('team-sso');
    expect(await e2e.state.native.authorizationRequestCount()).toBe(1);
    expect(await e2e.state.native.credentialCount()).toBe(0);
  });

  // feature:locale-ar:start
  // feature:locale-ar:end

  it.each([
    { provider_id: 'unknown' },
    { provider_id: 'https://evil.example' },
    { provider_id: '' },
    { provider_id: ['team-sso', 'team-sso'] },
    { provider_id: { id: 'team-sso' } },
    { flow: '' },
    { flow: 'link' },
    { flow: ['signIn', 'recovery'] },
    { locale: '' },
    { locale: 'en-US' },
    { locale: ['en', 'en'] },
    { provider_id: 'team-sso', flow: 'registration' },
    { provider_id: 'team-sso', flow: 'recovery' },
  ])(
    'rejects invalid selectors %j before creating a transaction',
    async (selectors) => {
      const response = await authorize(selectors);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'invalid_request' });
      expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
    },
  );

  it('rejects a configured but disabled provider before transaction creation', async () => {
    providerEnabled = false;
    const response = await authorize({ provider_id: 'team-sso' });
    expect(response.status).toBe(400);
    expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
  });

  it.each(['registration', 'recovery'])(
    'rejects the disabled password %s journey',
    async (flow) => {
      e2e.app.get(ConfigService).set('auth.passwordEnabled', false);
      const response = await authorize({ flow });
      expect(response.status).toBe(400);
      expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
    },
  );
});
// feature:oauth-core:end
