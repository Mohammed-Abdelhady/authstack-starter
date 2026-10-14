import { REFRESH_1_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { AuthDisposedError as EngineDisposedError } from '../../src/errors/errors';
import { parseStoredRecord } from '../../src/storage/persistence';
import { REFRESH_TOKEN, Deferred, apiReply } from '../support/support';
import {
  dpopChallenge,
  dpopTokenReply,
  establishBoundSession,
  refreshRequests,
} from '../support/device-bound-support';
import {
  allowBoundRefreshReplayAfterUnknownOutcome,
  allowRefreshReplayAfterDpopNonce,
  revokedTokens,
} from '../support/tracking';

function isRefreshRequest(request: { path: string; body?: unknown }): boolean {
  return (
    request.path === '/api/oauth/token' &&
    typeof request.body === 'object' &&
    request.body !== null &&
    'grant_type' in request.body &&
    request.body.grant_type === 'refresh_token'
  );
}

/** The code exchange is challenged first too, so signing in signs two proofs. */
const SIGN_IN_PROOFS = 2;

describe('device-bound refresh disposal', () => {
  it('does not start the one replacement when disposal precedes the lost answer', async () => {
    const { engine, ports, transport, deviceKey } = await establishBoundSession();
    ports.clock.advance(270_000);
    const refreshStarted = new Deferred<void>();
    const lostAnswer = new Deferred<never>();
    const deadlineCancelled = new Deferred<void>();
    ports.timer.onCancel = (milliseconds) => {
      if (milliseconds === 15_000) deadlineCancelled.resolve();
    };
    allowRefreshReplayAfterDpopNonce(REFRESH_TOKEN);
    let refreshAttempt = 0;
    transport.respond = async (request) => {
      if (!isRefreshRequest(request)) return apiReply({ id: 'profile' });
      refreshAttempt += 1;
      if (refreshAttempt === 1) return dpopChallenge();
      refreshStarted.resolve();
      return lostAnswer.promise;
    };
    const request = engine.transport.request({ method: 'GET', path: '/api/user/profile' });
    await refreshStarted.promise;
    engine.dispose();
    await expect(request).rejects.toBeInstanceOf(EngineDisposedError);
    lostAnswer.reject(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));
    await deadlineCancelled.promise;

    expect(refreshRequests(transport)).toHaveLength(2);
    expect(deviceKey.signed).toHaveLength(SIGN_IN_PROOFS + 2);
    expect(revokedTokens(transport)).toEqual([]);
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBe(true);
  });

  it('saves a late successful replacement when disposal lands during the retry', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    const retryStarted = new Deferred<void>();
    const lateAnswer = new Deferred<ReturnType<typeof dpopTokenReply>>();
    const replacementSaved = new Deferred<void>();
    ports.credentials.afterReplace = (value) => {
      const record = parseStoredRecord(value);
      if (record?.tokens?.refreshToken === REFRESH_1_TOKEN && !record.refreshInFlight)
        replacementSaved.resolve();
    };
    ports.clock.advance(270_000);
    allowRefreshReplayAfterDpopNonce(REFRESH_TOKEN);
    allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
    let refreshAttempt = 0;
    transport.respond = async (request) => {
      if (!isRefreshRequest(request)) return apiReply({ id: 'profile' });
      refreshAttempt += 1;
      if (refreshAttempt === 1) return dpopChallenge();
      if (refreshAttempt === 2) throw new TransportError(TRANSPORT_FAILURE.NO_RESPONSE);
      retryStarted.resolve();
      return lateAnswer.promise;
    };
    const request = engine.transport.request({ method: 'GET', path: '/api/user/profile' });
    await retryStarted.promise;
    engine.dispose();
    await expect(request).rejects.toBeInstanceOf(EngineDisposedError);
    lateAnswer.resolve(dpopTokenReply('access-1', REFRESH_1_TOKEN));
    await replacementSaved.promise;

    expect(refreshRequests(transport)).toHaveLength(3);
    expect(parseStoredRecord(ports.credentials.value ?? '')?.tokens?.refreshToken).toBe(
      REFRESH_1_TOKEN,
    );
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBeUndefined();
    expect(revokedTokens(transport)).toEqual([]);
    expect(engine.snapshot.status).toBe('signedOut');
  });
});
