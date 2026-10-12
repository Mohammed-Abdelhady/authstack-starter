import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { unwrapNativeMethods } from '@app/sdk';
import { OAuthRegistryService } from '../../../src/auth/oauth/oauth-registry.service';
import { OidcOAuthStrategy } from '../../../src/auth/oauth/strategies/oidc-oauth.strategy';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const PROVIDER_ID = 'native-label-issuer';
const ISSUER = 'https://issuer.example.test';
const LABEL_CASES = [
  {
    label: '161 letters',
    configured: 'p'.repeat(161),
    expected: 'p'.repeat(160),
  },
  {
    label: '160 letters',
    configured: 'p'.repeat(160),
    expected: 'p'.repeat(160),
  },
  {
    label: '81 supplementary letters',
    configured: '\u{10400}'.repeat(81),
    expected: '\u{10400}'.repeat(80),
  },
  {
    label: 'a supplementary letter crossing the boundary',
    configured: `${'p'.repeat(159)}\u{10400}z`,
    expected: 'p'.repeat(159),
  },
  {
    label: 'normalization before the boundary',
    configured: `${'p'.repeat(159)}E\u0301z`,
    expected: `${'p'.repeat(159)}É`,
  },
  {
    label: 'surrounding whitespace',
    configured: ' \tE\u0301mile\n ',
    expected: 'Émile',
  },
  { label: 'an empty configured label', configured: '', expected: PROVIDER_ID },
  {
    label: 'a blank configured label',
    configured: ' \t\n ',
    expected: PROVIDER_ID,
  },
];

describe.each(LABEL_CASES)(
  'native provider label projection for $label (e2e)',
  ({ configured, expected }) => {
    let e2e: E2eApp;

    beforeAll(async () => {
      const config = new ConfigService({
        oauth: {
          providers: {
            oidc: {
              enabled: true,
              clientId: 'label-client',
              clientSecret: 'synthetic-label-secret',
              extra: {
                PROVIDER_ID,
                DISPLAY_NAME: configured,
                ISSUER,
                AUTHORIZATION_URL: `${ISSUER}/authorize`,
                TOKEN_URL: `${ISSUER}/token`,
                USERINFO_URL: `${ISSUER}/userinfo`,
                JWKS_URL: `${ISSUER}/jwks`,
              },
            },
          },
        },
      });
      e2e = await bootE2eApp(0, {
        browserStrategy: new OidcOAuthStrategy(config),
        nativeEnabled: true,
        nativeCustomSchemeAllowed: true,
        nativeApplications: [
          {
            clientId: NATIVE_CLIENT_ID,
            displayName: 'Provider label client',
            redirectUris: [NATIVE_REDIRECT],
            allowedScopes: [DEFAULT_API_AUDIENCE],
            signIn: { providers: [{ id: PROVIDER_ID, mode: 'system' }] },
          },
        ],
      });
    }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await e2e?.close();
    }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

    it('projects both native catalogues including a disabled client while preserving browser metadata', async () => {
      const registry = e2e.app.get(OAuthRegistryService);
      const original = [{ id: PROVIDER_ID, displayName: configured }];
      expect(registry.listEnabled()).toEqual(original);
      for (const clientId of [NATIVE_CLIENT_ID, 'unknown-label-client']) {
        const response = await request(e2e.httpServer)
          .get('/api/auth/native/methods')
          .query({ clientId })
          .expect(200);
        expect(response.body).toMatchObject({
          data: {
            methods: { oauth: [{ id: PROVIDER_ID, displayName: expected }] },
            providers: [
              { id: PROVIDER_ID, displayName: expected, mode: 'system' },
            ],
          },
        });
        const parsed = unwrapNativeMethods(response);
        expect(parsed.nativeEnabled).toBe(clientId === NATIVE_CLIENT_ID);
        expect(parsed.methods.oauth).toEqual([
          { id: PROVIDER_ID, displayName: expected },
        ]);
        expect(parsed.providers).toEqual([
          { id: PROVIDER_ID, displayName: expected, mode: 'system' },
        ]);
        expect(response.headers['set-cookie']).toBeUndefined();
      }
      const browser = await request(e2e.httpServer)
        .get('/api/auth/oauth/providers')
        .expect(200);
      expect(browser.body).toMatchObject({ data: { providers: original } });
      expect(registry.listEnabled()).toEqual(original);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expect(await e2e.state.native.credentialCount()).toBe(0);
    });
  },
);
