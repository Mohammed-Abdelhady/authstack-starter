import { ConfigService } from '@nestjs/config';
import { AuthSessionError } from '@app/native-auth';
import {
  ApiError,
  OAuthError,
  TransportError,
  createApiClient,
} from '@app/sdk';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  apiErrorOf,
  bearerClient,
  publicClient,
} from '../../utils/sdk/sdk-transport';
import {
  createNativeApplication,
  NATIVE_CLIENT_ID,
} from '../../utils/native/native-authorize.fixtures';
import { SESSION_AUTHORITY_BOOT_TIMEOUT_MS } from '../../utils/hook-timeouts';
import {
  isRefreshBody,
  openEngine,
  refreshTokenRequests,
  signedInEngine,
} from '../../utils/native/native-auth-engine-harness';

describe('native auth engine against the server', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  });

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
    await createNativeApplication(e2e);
  });

  it('signs in through native authorization and reads the profile immediately', async () => {
    const { engine, requests, authorizationAddresses } = await openEngine(e2e);
    const outcome = await engine.signIn();

    expect(outcome.kind).toBe('signedIn');
    expect(engine.snapshot.status).toBe('signedIn');
    expect(engine.snapshot.profile?.email).toBe('user@seed.local');
    expect(requests.some(({ path }) => path === '/api/user/profile')).toBe(
      true,
    );
    expect(requests.some(({ path }) => path === '/api/oauth/token')).toBe(true);
    expect(
      new URL(authorizationAddresses[0] ?? '').searchParams.get('state'),
    ).toBe('AgICAgICAgICAgICAgICAg');
  });

  it('parses the server denial redirect as access_denied', async () => {
    const { engine, requests } = await openEngine(e2e, undefined, 'deny');

    const outcome = await engine.signIn();

    expect(outcome).toEqual({
      kind: 'authorizationDenied',
      error: 'access_denied',
    });
    expect(engine.snapshot).toMatchObject({
      status: 'signedOut',
      operation: 'none',
    });
    expect(
      requests.filter(({ path }) => path === '/api/oauth/token'),
    ).toHaveLength(0);
  });

  it('sends an authenticated SDK profile request with the bearer token', async () => {
    const { engine, requests } = await signedInEngine(e2e);
    const client = createApiClient(engine.transport);

    const profile = await client.profile.get();

    expect(profile.email).toBe('user@seed.local');
    const request = requests.find(({ path }) => path === '/api/user/profile');
    expect(request?.headers?.Authorization).toMatch(/^Bearer .+/);
  });

  it('refreshes on the first request after the access lifetime', async () => {
    const { engine, ports, requests } = await signedInEngine(e2e);
    const client = createApiClient(engine.transport);
    ports.clock.advance(300_001);

    const first = await client.profile.get();
    const refreshes = refreshTokenRequests(requests);

    expect(first.email).toBe('user@seed.local');
    expect(refreshes).toHaveLength(1);
    expect(engine.snapshot.status).toBe('signedIn');
  });

  it('refreshes and replays when the server returns 401 before the local margin', async () => {
    const { engine, requests, responses } = await signedInEngine(e2e);
    const client = createApiClient(engine.transport);
    const requestStart = requests.length;
    e2e.clock.advance(300_001);

    const profile = await client.profile.get();
    const profileRequests = requests
      .slice(requestStart)
      .flatMap((request, index) =>
        request.path === '/api/user/profile'
          ? [{ request, response: responses[requestStart + index] }]
          : [],
      );
    const refresh = refreshTokenRequests(requests)[0];
    const refreshIndex = requests.indexOf(refresh);
    const refreshes = refreshTokenRequests(requests);
    const firstProfileIndex = requests.indexOf(profileRequests[0]?.request);
    const replayProfileIndex = requests.indexOf(profileRequests[1]?.request);

    expect(profile.email).toBe('user@seed.local');
    expect(profileRequests).toHaveLength(2);
    expect(refreshes).toHaveLength(1);
    expect(profileRequests[0]?.response?.status).toBe(401);
    expect(requests[refreshIndex]?.path).toBe('/api/oauth/token');
    expect(refreshIndex).toBeGreaterThan(firstProfileIndex);
    expect(refreshIndex).toBeLessThan(replayProfileIndex);
    expect(responses[refreshIndex]?.status).toBe(200);
    expect(profileRequests[1]?.response?.status).toBe(200);
    expect(engine.snapshot.status).toBe('signedIn');
  });

  it('requires sign-in after the server rotates a token whose answer is lost', async () => {
    const { engine, ports, requests, responses } = await signedInEngine(e2e);
    const client = createApiClient(engine.transport);
    ports.clock.advance(300_001);
    e2e.clock.advance(300_001);
    ports.loseNextRefreshResponse();

    await expect(client.profile.get()).rejects.toBeInstanceOf(TransportError);

    const refreshes = refreshTokenRequests(requests);
    const refreshIndex = requests.findIndex(
      ({ path, body }) => path === '/api/oauth/token' && isRefreshBody(body),
    );
    expect(refreshes).toHaveLength(1);
    expect(responses[refreshIndex]?.status).toBe(200);
    expect(engine.snapshot.status).toBe('reauthRequired');
    await expect(client.profile.get()).rejects.toBeInstanceOf(AuthSessionError);
    expect(refreshTokenRequests(requests)).toHaveLength(1);
  });

  it('maps the kill switch during code exchange after browser approval', async () => {
    const { engine, ports, requests, responses } = await openEngine(e2e);
    ports.beforeTransportRequest = ({ path, body }) => {
      if (path === '/api/oauth/token' && isCodeExchangeBody(body)) {
        e2e.app.get(ConfigService).set('auth.nativeEnabled', false);
      }
    };

    const outcome = await engine.signIn();
    const exchangeIndex = requests.findIndex(
      ({ path, body }) =>
        path === '/api/oauth/token' && isCodeExchangeBody(body),
    );

    expect(outcome.kind).toBe('disabled');
    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.reason).toBe('disabled');
    expect(responses[exchangeIndex]?.body).toEqual({
      error: 'unauthorized_client',
      error_description: 'NATIVE_AUTH_DISABLED',
    });
  });

  it('keeps the rotated token on a request made after refresh completes', async () => {
    const { engine, ports, requests } = await signedInEngine(e2e);
    const client = createApiClient(engine.transport);
    ports.clock.advance(300_001);

    await client.profile.get();
    const later = await client.profile.get();
    const profiles = requests.filter(
      ({ path }) => path === '/api/user/profile',
    );
    const nextToken = profiles[1]?.headers?.Authorization;

    expect(later.email).toBe('user@seed.local');
    expect(profiles).toHaveLength(3);
    expect(nextToken).toMatch(/^Bearer .+/);
    expect(nextToken).not.toBe(profiles[0]?.headers?.Authorization);
    expect(profiles[2]?.headers?.Authorization).toBe(nextToken);
  });

  it('refuses a protected request after sign out without sending it', async () => {
    const { engine, ports, requests, responses } = await signedInEngine(e2e);
    const client = createApiClient(engine.transport);
    ports.clock.advance(300_001);
    const result = await engine.signOut();
    const sentBefore = requests.length;

    await expect(client.profile.get()).rejects.toBeInstanceOf(AuthSessionError);

    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.reason).toBeUndefined();
    expect(result).toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    expect(requests.length).toBe(sentBefore);
    const exchangeIndex = requests.findIndex(
      ({ path, body }) =>
        path === '/api/oauth/token' && isCodeExchangeBody(body),
    );
    const revoke = requests.find(({ path }) => path === '/api/oauth/revoke');
    const exchangeResponse = responses[exchangeIndex]?.body;
    const revokeBody = revoke?.body;
    expect(isTokenReply(exchangeResponse)).toBe(true);
    expect(isRevokeBody(revokeBody)).toBe(true);
    if (isTokenReply(exchangeResponse) && isRevokeBody(revokeBody)) {
      expect(revokeBody.token).toBe(exchangeResponse.refresh_token);
    }
    expect(requests.some(({ path }) => path === '/api/auth/logout')).toBe(
      false,
    );
    if (isTokenReply(exchangeResponse)) {
      const revokedAccess = await apiErrorOf(
        bearerClient(e2e, exchangeResponse.access_token).profile.get(),
      );
      expect(revokedAccess).toBeInstanceOf(ApiError);
      expect(revokedAccess).toMatchObject({
        status: 401,
        code: 'SESSION_INVALID',
      });
    }
  });

  it('maps the server kill-switch description after a refresh attempt', async () => {
    const { engine, ports } = await signedInEngine(e2e);
    const client = createApiClient(engine.transport);
    e2e.app.get(ConfigService).set('auth.nativeEnabled', false);
    ports.clock.advance(300_001);
    const profile = client.profile.get();

    await expect(profile).rejects.toBeInstanceOf(OAuthError);
    await expect(profile).rejects.toMatchObject({
      error: 'unauthorized_client',
      errorDescription: 'NATIVE_AUTH_DISABLED',
    });
    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.reason).toBe('disabled');
  });

  it('exchanges a loopback callback on the runtime-selected port', async () => {
    const registeredRedirect = 'http://127.0.0.1/callback';
    const runtimeRedirect = 'http://127.0.0.1:49152/callback';
    await e2e.state.applications.changeApplication(NATIVE_CLIENT_ID, {
      redirectUris: [registeredRedirect],
    });
    const { engine, requests } = await openEngine(e2e, runtimeRedirect);

    const outcome = await engine.signIn();
    const exchange = requests.find(
      ({ path, body }) =>
        path === '/api/oauth/token' && isCodeExchangeBody(body),
    );

    expect(outcome.kind).toBe('signedIn');
    expect(exchange?.body).toMatchObject({ redirect_uri: runtimeRedirect });
  });

  it('ends signed out after the server detects a replayed refresh token', async () => {
    const { engine, ports, requests } = await signedInEngine(e2e);
    const client = createApiClient(engine.transport);
    ports.clock.advance(300_001);
    await client.profile.get();
    const originalRefresh = refreshTokenRequests(requests)[0]?.body;
    if (!isRefreshBody(originalRefresh))
      throw new Error('Refresh request was not captured');

    const replay = publicClient(e2e).oauth.refresh({
      refreshToken: originalRefresh.refresh_token,
      clientId: NATIVE_CLIENT_ID,
    });
    await expect(replay).rejects.toBeInstanceOf(OAuthError);
    await expect(replay).rejects.toMatchObject({
      error: 'invalid_grant',
      status: 400,
    });
    const refusedRequest = client.profile.get();
    await expect(refusedRequest).rejects.toBeInstanceOf(OAuthError);
    await expect(refusedRequest).rejects.toMatchObject({
      error: 'invalid_grant',
      status: 400,
    });

    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.reason).toBe('oauthFailure');
  });
});

function isCodeExchangeBody(
  value: unknown,
): value is { grant_type: string; redirect_uri: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'grant_type' in value &&
    value.grant_type === 'authorization_code' &&
    'redirect_uri' in value &&
    typeof value.redirect_uri === 'string'
  );
}

function isTokenReply(
  value: unknown,
): value is { access_token: string; refresh_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'refresh_token' in value &&
    typeof value.refresh_token === 'string' &&
    'access_token' in value &&
    typeof value.access_token === 'string'
  );
}

function isRevokeBody(value: unknown): value is { token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof value.token === 'string'
  );
}
