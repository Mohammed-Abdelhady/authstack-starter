import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AuthEpochService } from '../../../src/common/services/auth-epoch.service';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
} from '../../../src/session/constants/client-ids';
import {
  NATIVE_ABSOLUTE_LIFETIME_MS,
  NATIVE_IDLE_LIFETIME_MS,
} from '../../../src/session/constants/session-policy';
import {
  NATIVE_CLIENT_ID,
  nativeAuthorizeQuery,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import { seedUserId } from '../../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { TEST_NOW } from '../../utils/frozen-clock';

const LOOPBACK_REGISTERED = 'http://127.0.0.1:3000/callback';
const LOOPBACK_REQUESTED = 'http://127.0.0.1:4123/callback';
const LOOPBACK_WRONG_PATH = 'http://127.0.0.1:4123/other';
const HTTPS_REGISTERED = 'https://client.example/callback';
const HTTPS_OTHER_PORT = 'https://client.example:8443/callback';
const CUSTOM_REDIRECT = 'myapp://oauth/callback';

describe('native return addresses (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
  });

  it('accepts a loopback address on another port and exchanges the address sent', async () => {
    await createLoopbackApplication(e2e, [LOOPBACK_REGISTERED]);
    const verifier = randomBytes(32).toString('base64url');
    const started = await request(e2e.httpServer)
      .get('/api/oauth/authorize')
      .query(
        nativeAuthorizeQuery(verifier, { redirect_uri: LOOPBACK_REQUESTED }),
      )
      .redirects(0);
    expect(started.status).toBe(302);
    const transactionId = new URL(
      String(started.headers.location),
    ).searchParams.get('transaction');
    if (!transactionId) {
      throw new Error('Native authorization redirect has no transaction id');
    }

    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const approval = await browser
      .post('/api/oauth/authorize/approve')
      .send({ transactionId, expectedUserId: await seedUserId(e2e) })
      .expect(200);
    const code = new URL(
      String(
        (approval.body as { data: { redirectUri: string } }).data.redirectUri,
      ),
    ).searchParams.get('code');
    if (!code) {
      throw new Error('authorization code is missing');
    }

    const wrongPort = await request(e2e.httpServer)
      .post('/api/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOOPBACK_REGISTERED,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: verifier,
      });
    expect(wrongPort.status).toBe(400);
    expect(wrongPort.body).toEqual({ error: 'invalid_grant' });

    const exchanged = await request(e2e.httpServer)
      .post('/api/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOOPBACK_REQUESTED,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: verifier,
      })
      .expect(200);
    expect(typeof exchanged.body.access_token).toBe('string');
  });

  it('refuses a loopback address with a different path', async () => {
    await createLoopbackApplication(e2e, [LOOPBACK_REGISTERED]);

    const response = await request(e2e.httpServer)
      .get('/api/oauth/authorize')
      .query(
        nativeAuthorizeQuery(randomBytes(32).toString('base64url'), {
          redirect_uri: LOOPBACK_WRONG_PATH,
        }),
      );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid_request' });
    expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
  });

  it('refuses a non-loopback address with a different port', async () => {
    await createLoopbackApplication(e2e, [HTTPS_REGISTERED]);

    const response = await request(e2e.httpServer)
      .get('/api/oauth/authorize')
      .query(
        nativeAuthorizeQuery(randomBytes(32).toString('base64url'), {
          redirect_uri: HTTPS_OTHER_PORT,
        }),
      );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid_request' });
    expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
  });

  it('refuses a custom scheme in production without the setting at authorize time', async () => {
    await createLoopbackApplication(e2e, [CUSTOM_REDIRECT], 'production');
    const config = e2e.app.get(ConfigService);
    const nodeEnv = config.get<string>('server.nodeEnv');
    const allowed = config.get<boolean>('auth.nativeCustomSchemeAllowed');
    config.set('server.nodeEnv', 'production');
    config.set('auth.nativeCustomSchemeAllowed', false);
    try {
      const refused = await request(e2e.httpServer)
        .get('/api/oauth/authorize')
        .query(
          nativeAuthorizeQuery(randomBytes(32).toString('base64url'), {
            redirect_uri: CUSTOM_REDIRECT,
          }),
        );
      expect(refused.status).toBe(400);
      expect(refused.body).toEqual({ error: 'invalid_request' });

      config.set('auth.nativeCustomSchemeAllowed', true);
      const accepted = await request(e2e.httpServer)
        .get('/api/oauth/authorize')
        .query(
          nativeAuthorizeQuery(randomBytes(32).toString('base64url'), {
            redirect_uri: CUSTOM_REDIRECT,
          }),
        )
        .redirects(0);
      expect(accepted.status).toBe(302);
    } finally {
      config.set('server.nodeEnv', nodeEnv);
      config.set('auth.nativeCustomSchemeAllowed', allowed);
    }
  });
});

describe('native custom scheme registration in production (e2e)', () => {
  let production: E2eApp | undefined;

  afterEach(async () => {
    await production?.close();
    production = undefined;
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it(
    'refuses a custom scheme in production without the setting',
    async () => {
      await expect(
        bootE2eApp(0, {
          nodeEnv: 'production',
          nativeEnabled: true,
          nativeApplications: [
            {
              clientId: NATIVE_CLIENT_ID,
              displayName: 'Configured Mobile',
              redirectUris: [CUSTOM_REDIRECT],
              allowedScopes: ['api'],
            },
          ],
        }),
      ).rejects.toThrow(/redirectUris\[0\]/);
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );

  it(
    'accepts a custom scheme in production with the setting on',
    async () => {
      production = await bootE2eApp(0, {
        nodeEnv: 'production',
        nativeEnabled: true,
        nativeCustomSchemeAllowed: true,
        nativeApplications: [
          {
            clientId: NATIVE_CLIENT_ID,
            displayName: 'Configured Mobile',
            redirectUris: [CUSTOM_REDIRECT],
            allowedScopes: ['api'],
          },
        ],
      });

      const response = await request(production.httpServer)
        .get('/api/oauth/authorize')
        .query(
          nativeAuthorizeQuery(randomBytes(32).toString('base64url'), {
            redirect_uri: CUSTOM_REDIRECT,
          }),
        )
        .redirects(0);

      expect(response.status).toBe(302);
      expect(String(response.headers.location)).toContain('transaction=');
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );
});

async function createLoopbackApplication(
  e2e: E2eApp,
  redirectUris: string[],
  environment?: string,
): Promise<void> {
  await e2e.state.applications.createApplication({
    clientId: NATIVE_CLIENT_ID,
    displayName: 'Native loopback client',
    platform: APPLICATION_PLATFORM.NATIVE,
    environment: environment ?? e2e.app.get(AuthEpochService).environment(),
    clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
    enabled: true,
    redirectUris,
    allowedOrigins: [],
    audiences: [DEFAULT_API_AUDIENCE],
    allowedScopes: [DEFAULT_API_AUDIENCE],
    policy: {
      absoluteLifetimeMs: NATIVE_ABSOLUTE_LIFETIME_MS,
      idleLifetimeMs: NATIVE_IDLE_LIFETIME_MS,
    },
    sessionVersion: 0,
  });
}
