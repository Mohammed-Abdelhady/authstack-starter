// feature:oauth-core:start
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { OAuthProviderStrategy } from '../../../src/auth/oauth/oauth-provider.interface';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const PROVIDER: OAuthProviderStrategy = {
  id: 'team-sso',
  displayName: 'Team SSO',
  envPrefix: 'FIXTURE',
  supportsPkce: true,
  usesOidc: false,
  emailAlwaysVerified: true,
  autoLinksByEmail: false,
  callbackMethod: 'GET',
  isEnabled: () => true,
  getAuthorizationUrl: () => 'https://provider.example/authorize',
  exchangeCode: () =>
    Promise.reject(new Error('No provider exchange in this fixture')),
  fetchProfile: () =>
    Promise.reject(new Error('No provider profile in this fixture')),
};

/** Its only way in opens the provider in the system browser. */
const SYSTEM_ONLY = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'System browser only',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: { providers: [{ id: PROVIDER.id, mode: 'system' as const }] },
};

/**
 * A system-browser provider signs in through the browser authorization, which
 * never uses a native attempt: the engine cancels any attempt before it opens
 * the browser. So the application offers no attempt and still signs people in.
 */
describe('native application whose only way in is a system-browser provider', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: [SYSTEM_ONLY],
      browserStrategy: PROVIDER,
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('offers the provider in the system browser and no native factor', async () => {
    const methods = await request(e2e.httpServer)
      .get('/api/auth/native/methods')
      .query({ clientId: NATIVE_CLIENT_ID })
      .expect(200);
    const body: unknown = methods.body;
    expect(body).toMatchObject({
      data: {
        nativeEnabled: true,
        providers: [{ id: PROVIDER.id, mode: 'system' }],
        capabilities: {
          password: false,
          emailLink: false,
          passkeys: false,
          registration: false,
          recovery: false,
        },
      },
    });
  });

  it('starts no native attempt, which this application never needs', async () => {
    const query = nativeAuthorizeQuery(randomBytes(32).toString('base64url'));
    const response = await request(e2e.httpServer)
      .post('/api/auth/native/attempts')
      .send({
        clientId: NATIVE_CLIENT_ID,
        redirectUri: NATIVE_REDIRECT,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: 'S256',
        state: query.state,
        scopes: [DEFAULT_API_AUDIENCE],
        flow: 'signIn',
      })
      .expect(404);
    const body: unknown = response.body;
    expect(body).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });
  });
});
// feature:oauth-core:end
