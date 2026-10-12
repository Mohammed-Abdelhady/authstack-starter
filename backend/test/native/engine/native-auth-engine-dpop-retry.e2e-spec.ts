import { ConfigService } from '@nestjs/config';
import { DPOP_PROOF_HEADER, OAUTH_ERROR, createApiClient } from '@app/sdk';
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
  openEngineWithDeviceKey,
  readStoredAuthRecord,
  type EngineHarness,
} from '../../utils/native/native-auth-engine-harness';
import {
  ACCESS_TOKEN_MARGIN_MS,
  advanceAccessClock,
  credentialsFor,
  firstNonce,
  parseProof,
  refreshTokenFrom,
  requiredSessionFields,
  tokenEntries,
  tokenReply,
} from '../../utils/native/native-auth-engine-dpop-support';

const RETRY_IN_PROGRESS_REASON = NATIVE_DPOP_FAILURE_REASON.RETRY_IN_PROGRESS;

describe('native auth engine bound lost-answer retry (e2e)', () => {
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

  it('recovers one lost refresh answer, revokes the first successor, and keeps the lineage', async () => {
    const harness = await openEngineWithDeviceKey(e2e);
    await expectSignedIn(harness);
    const previous = requiredSessionFields(
      await readStoredAuthRecord(harness.ports),
    );
    const client = createApiClient(harness.engine.transport);
    advanceAccessClock(harness, ACCESS_TOKEN_MARGIN_MS);
    harness.ports.loseNextRefreshResponse();

    const profile = await client.profile.get();
    const refreshes = tokenEntries(harness).filter(({ request }) =>
      isRefreshBody(request.body),
    );
    const initialProof = parseProof(refreshes[1]?.request);
    const retryProof = parseProof(refreshes[2]?.request);
    const discarded = tokenReply(refreshes[1]?.response?.body);
    const replacement = tokenReply(refreshes[2]?.response?.body);
    const discardedRows = await credentialsFor(e2e, discarded);
    const replacementRows = await credentialsFor(e2e, replacement);
    const stored = requiredSessionFields(
      await readStoredAuthRecord(harness.ports),
    );

    expect(profile.email).toBe('user@seed.local');
    expect(refreshes).toHaveLength(3);
    expect(
      refreshes.map(({ request }) => refreshTokenFrom(request.body)),
    ).toEqual([
      previous.refreshToken,
      previous.refreshToken,
      previous.refreshToken,
    ]);
    expect(refreshes[1]?.response?.status).toBe(200);
    expect(refreshes[2]?.response?.status).toBe(200);
    expect(initialProof.claims.jti).not.toBe(retryProof.claims.jti);
    expect(discardedRows).toHaveLength(2);
    expect(
      discardedRows.every(({ revokedAt }) => revokedAt instanceof Date),
    ).toBe(true);
    expect(
      replacementRows.map(({ proofKeyThumbprint }) => proofKeyThumbprint),
    ).toEqual([
      '2Z-ICOWJ-osZEZ-v5VqCUGhisbZ2H1ilwlEG3R_VECU',
      '2Z-ICOWJ-osZEZ-v5VqCUGhisbZ2H1ilwlEG3R_VECU',
    ]);
    expect(stored.refreshToken).toBe(replacement.refresh_token);
    expect(stored.lineageId).toBe(previous.lineageId);
    expect((await client.profile.get()).email).toBe('user@seed.local');
    expect(
      tokenEntries(harness).filter(({ request }) =>
        isRefreshBody(request.body),
      ),
    ).toHaveLength(3);
  });

  it('does not send a third refresh after the server reports retry-in-progress', async () => {
    const harness = await openEngineWithDeviceKey(e2e);
    await expectSignedIn(harness);
    const previous = requiredSessionFields(
      await readStoredAuthRecord(harness.ports),
    );
    const client = createApiClient(harness.engine.transport);
    advanceAccessClock(harness, ACCESS_TOKEN_MARGIN_MS);
    harness.ports.loseNextRefreshResponse();
    let competitorTokenType: string | undefined;
    harness.ports.afterLostRefreshResponse = async () => {
      const proof = await harness.makeDpopProof(
        previous.refreshToken,
        firstNonce(harness),
      );
      const pair = await publicClient(e2e).oauth.refresh(
        { refreshToken: previous.refreshToken, clientId: NATIVE_CLIENT_ID },
        { headers: { [DPOP_PROOF_HEADER]: proof } },
      );
      competitorTokenType = pair.tokenType;
    };

    await expect(client.profile.get()).rejects.toMatchObject({
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      errorDescription: RETRY_IN_PROGRESS_REASON,
    });
    const refreshes = tokenEntries(harness).filter(({ request }) =>
      isRefreshBody(request.body),
    );
    const final = refreshes.at(-1);

    expect(competitorTokenType).toBe('Bearer');
    expect(refreshes).toHaveLength(3);
    expect(
      refreshes.map(({ request }) => refreshTokenFrom(request.body)),
    ).toEqual([
      previous.refreshToken,
      previous.refreshToken,
      previous.refreshToken,
    ]);
    expect(refreshes[0]?.response?.body).toMatchObject({
      error: OAUTH_ERROR.USE_DPOP_NONCE,
      error_description: NATIVE_DPOP_FAILURE_REASON.NONCE_INVALID,
    });
    expect(refreshes[1]?.response?.status).toBe(200);
    expect(final?.response?.status).toBe(400);
    expect(final?.response?.body).toMatchObject({
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: RETRY_IN_PROGRESS_REASON,
    });
    expect(harness.engine.snapshot.status).toBe('reauthRequired');
    expect((await readStoredAuthRecord(harness.ports))?.refreshInFlight).toBe(
      true,
    );
  });
});

async function expectSignedIn(harness: EngineHarness): Promise<void> {
  const outcome = await harness.engine.signIn();
  expect(outcome.kind).toBe('signedIn');
}
