import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import request from 'supertest';
import {
  API_PATHS,
  DPOP_PROOF_HEADER,
  OAUTH_ERROR,
  OAUTH_GRANT_TYPE,
  createApiClient,
} from '@app/sdk';
import { NATIVE_DPOP_FAILURE_REASON } from '../../../src/session/constants/session-policy';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import { publicClient } from '../../utils/sdk/sdk-transport';
import {
  NATIVE_CLIENT_ID,
  createNativeApplication,
} from '../../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  isRefreshBody,
  openEngine,
  openEngineWithDeviceKey,
  readStoredAuthRecord,
  signedInEngine,
  type EngineHarness,
} from '../../utils/native/native-auth-engine-harness';
import { FIXED_PUBLIC_JWK } from '../../../../mobile/auth/test/support/software-device-key';
import {
  credentialsFor,
  credentialsForToken,
  isCodeExchange,
  parseProof,
  parseProofOptional,
  refreshTokenFrom,
  requiredSessionFields,
  revokeTokenFrom,
  sessionFor,
  tokenEntries,
  tokenReply,
  ACCESS_TOKEN_MARGIN_MS,
  advanceAccessClock,
} from '../../utils/native/native-auth-engine-dpop-support';

const FIXED_THUMBPRINT = '2Z-ICOWJ-osZEZ-v5VqCUGhisbZ2H1ilwlEG3R_VECU';

describe('native auth engine device-bound sessions (e2e)', () => {
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
    const config = e2e.app.get(ConfigService);
    config.set('auth.nativeEnabled', true);
    config.set('auth.nativeDpopRequired', false);
    await createNativeApplication(e2e);
  });

  it('stores the exchange thumbprint on the session, credentials, and engine record', async () => {
    const harness = await openEngineWithDeviceKey(e2e);
    const outcome = await harness.engine.signIn();
    const exchange = tokenEntries(harness).find(
      ({ request, response }) =>
        isCodeExchange(request.body) && response?.status === 200,
    );
    const pair = tokenReply(exchange?.response?.body);
    const rows = await credentialsFor(e2e, pair);
    const session = await sessionFor(e2e, rows[0]?.sessionId);
    const stored = await readStoredAuthRecord(harness.ports);

    // The scheme the token reply names is the one the API accepts.
    const profile = await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Authorization', `${pair.token_type} ${pair.access_token}`);

    expect(outcome.kind).toBe('signedIn');
    expect(pair.token_type).toBe('Bearer');
    expect(profile.status).toBe(200);
    expect(rows.map(({ proofKeyThumbprint }) => proofKeyThumbprint)).toEqual([
      FIXED_THUMBPRINT,
      FIXED_THUMBPRINT,
    ]);
    expect(session.proofKeyThumbprint).toBe(FIXED_THUMBPRINT);
    expect(stored).toMatchObject({ proofKeyThumbprint: FIXED_THUMBPRINT });
    expect(stored?.tokens?.refreshToken).toBe(pair.refresh_token);
    expect(parseProof(exchange?.request).header).toMatchObject({
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: FIXED_PUBLIC_JWK,
    });
  });

  it('retries an exchange nonce challenge once with the same code and a fresh jti', async () => {
    const harness = await openEngineWithDeviceKey(e2e);
    const outcome = await harness.engine.signIn();
    const exchanges = tokenEntries(harness).filter(({ request }) =>
      isCodeExchange(request.body),
    );
    const firstProof = parseProof(exchanges[0]?.request);
    const secondProof = parseProof(exchanges[1]?.request);
    const nonce = exchanges[0]?.response?.headers?.['DPoP-Nonce'];

    expect(outcome.kind).toBe('signedIn');
    expect(exchanges).toHaveLength(2);
    expect(exchanges[1]?.request.body).toMatchObject({
      grant_type: OAUTH_GRANT_TYPE.AUTHORIZATION_CODE,
      code: codeFrom(exchanges[0]?.request.body),
    });
    expect(exchanges[0]?.response?.body).toMatchObject({
      error: OAUTH_ERROR.USE_DPOP_NONCE,
      error_description: NATIVE_DPOP_FAILURE_REASON.NONCE_INVALID,
    });
    expect(typeof nonce).toBe('string');
    expect(firstProof.claims.nonce).toBe('');
    expect(secondProof.claims.nonce).toBe(nonce);
    expect(firstProof.claims.jti).not.toBe(secondProof.claims.jti);
    expect(exchanges[1]?.response?.status).toBe(200);
  });

  it('rotates a bound pair with ath and retries the refresh nonce challenge', async () => {
    const harness = await openEngineWithDeviceKey(e2e);
    await expectSignedIn(harness);
    const previous = requiredSessionFields(
      await readStoredAuthRecord(harness.ports),
    );
    advanceAccessClock(harness, ACCESS_TOKEN_MARGIN_MS);

    const profile = await createApiClient(
      harness.engine.transport,
    ).profile.get();
    const refreshes = tokenEntries(harness).filter(({ request }) =>
      isRefreshBody(request.body),
    );
    const firstProof = parseProof(refreshes[0]?.request);
    const secondProof = parseProof(refreshes[1]?.request);
    const nonce = refreshes[0]?.response?.headers?.['DPoP-Nonce'];
    const pair = tokenReply(refreshes[1]?.response?.body);
    const next = requiredSessionFields(
      await readStoredAuthRecord(harness.ports),
    );
    const rows = await credentialsFor(e2e, pair);
    const session = await sessionFor(e2e, rows[0]?.sessionId);

    expect(profile.email).toBe('user@seed.local');
    expect(refreshes).toHaveLength(2);
    expect(
      refreshes.map(({ request }) => refreshTokenFrom(request.body)),
    ).toEqual([previous.refreshToken, previous.refreshToken]);
    expect(refreshes[0]?.response?.body).toMatchObject({
      error: OAUTH_ERROR.USE_DPOP_NONCE,
      error_description: NATIVE_DPOP_FAILURE_REASON.NONCE_INVALID,
    });
    expect(typeof nonce).toBe('string');
    expect(firstProof.claims.ath).toBe(tokenHashClaim(previous.refreshToken));
    expect(secondProof.claims.ath).toBe(tokenHashClaim(previous.refreshToken));
    expect(secondProof.claims.nonce).toBe(nonce);
    expect(firstProof.claims.jti).not.toBe(secondProof.claims.jti);
    expect(pair.token_type).toBe('Bearer');
    expect(next.lineageId).toBe(previous.lineageId);
    expect(next.proofKeyThumbprint).toBe(FIXED_THUMBPRINT);
    expect(rows.map(({ proofKeyThumbprint }) => proofKeyThumbprint)).toEqual([
      FIXED_THUMBPRINT,
      FIXED_THUMBPRINT,
    ]);
    expect(session.proofKeyThumbprint).toBe(FIXED_THUMBPRINT);
  });

  it('surfaces the required-mode outcome for an exchange without a device key', async () => {
    e2e.app.get(ConfigService).set('auth.nativeDpopRequired', true);
    const harness = await openEngine(e2e);

    const outcome = await harness.engine.signIn();
    const exchange = tokenEntries(harness).find(({ request }) =>
      isCodeExchange(request.body),
    );

    expect(outcome.kind).toBe('deviceBindingRequired');
    expect(harness.engine.snapshot.reason).toBe('deviceBindingRequired');
    expect(exchange?.request.headers?.[DPOP_PROOF_HEADER]).toBeUndefined();
    expect(exchange?.response?.body).toEqual({
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: NATIVE_DPOP_FAILURE_REASON.REQUIRED,
    });
  });

  it('revokes the bound family with ath after one nonce challenge', async () => {
    const harness = await openEngineWithDeviceKey(e2e);
    await expectSignedIn(harness);
    const session = requiredSessionFields(
      await readStoredAuthRecord(harness.ports),
    );

    const outcome = await harness.engine.signOut();
    const revokes = tokenEntries(harness).filter(
      ({ request }) => request.path === API_PATHS.oauth.revoke,
    );
    const firstProof = parseProof(revokes[0]?.request);
    const secondProof = parseProof(revokes[1]?.request);
    const nonce = revokes[0]?.response?.headers?.['DPoP-Nonce'];
    const rows = await credentialsForToken(e2e, session.refreshToken);
    const serverSession = await sessionFor(e2e, rows[0]?.sessionId);

    expect(outcome).toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    expect(revokes).toHaveLength(2);
    expect(revokes[0]?.response?.body).toMatchObject({
      error: OAUTH_ERROR.USE_DPOP_NONCE,
      error_description: NATIVE_DPOP_FAILURE_REASON.NONCE_INVALID,
    });
    expect(typeof nonce).toBe('string');
    expect(revokes.map(({ request }) => revokeTokenFrom(request.body))).toEqual(
      [session.refreshToken, session.refreshToken],
    );
    expect(firstProof.claims.ath).toBe(tokenHashClaim(session.refreshToken));
    expect(secondProof.claims.ath).toBe(tokenHashClaim(session.refreshToken));
    expect(secondProof.claims.nonce).toBe(nonce);
    expect(firstProof.claims.jti).not.toBe(secondProof.claims.jti);
    expect(serverSession.isValid).toBe(false);
    expect(rows.every(({ revokedAt }) => revokedAt instanceof Date)).toBe(true);
  });

  it('refuses a copied token without its key and still lets the engine refresh', async () => {
    const harness = await openEngineWithDeviceKey(e2e);
    await expectSignedIn(harness);
    const session = requiredSessionFields(
      await readStoredAuthRecord(harness.ports),
    );

    await expect(
      publicClient(e2e).oauth.refresh({
        refreshToken: session.refreshToken,
        clientId: NATIVE_CLIENT_ID,
      }),
    ).rejects.toMatchObject({
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      errorDescription: NATIVE_DPOP_FAILURE_REASON.PROOF_REQUIRED,
    });
    expect(
      (await credentialsForToken(e2e, session.refreshToken))[0]?.spent,
    ).toBe(false);
    advanceAccessClock(harness, ACCESS_TOKEN_MARGIN_MS);
    expect(
      (await createApiClient(harness.engine.transport).profile.get()).email,
    ).toBe('user@seed.local');
    expect(harness.engine.snapshot.status).toBe('signedIn');
  });

  it('keeps the no-key bearer exchange and refresh path unchanged', async () => {
    const harness = await signedInEngine(e2e);
    const exchange = tokenEntries(harness).find(({ request }) =>
      isCodeExchange(request.body),
    );

    expect(tokenReply(exchange?.response?.body).token_type).toBe('Bearer');
    expect(parseProofOptional(exchange?.request)).toBeUndefined();
    advanceAccessClock(harness, ACCESS_TOKEN_MARGIN_MS);
    expect(
      (await createApiClient(harness.engine.transport).profile.get()).email,
    ).toBe('user@seed.local');
    const refreshes = tokenEntries(harness).filter(({ request }) =>
      isRefreshBody(request.body),
    );
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.request.headers?.[DPOP_PROOF_HEADER]).toBeUndefined();
    expect(tokenReply(refreshes[0]?.response?.body).token_type).toBe('Bearer');
  });
});

async function expectSignedIn(harness: EngineHarness): Promise<void> {
  const outcome = await harness.engine.signIn();
  expect(outcome.kind).toBe('signedIn');
}

function tokenHashClaim(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function codeFrom(value: unknown): string | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
  )
    return value.code;
  return undefined;
}
