import { describe, expect, it } from 'vitest';
import { ApiError, OAuthError, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { DeviceBindingRequiredError, DeviceKeyAuthError } from '../../src/errors/errors';
import { parseStoredRecord } from '../../src/storage/persistence';
import {
  dpopTokenReply,
  enqueueBoundRefresh,
  establishBoundSession,
  refreshRequests,
} from '../support/device-bound-support';
import { REFRESH_TOKEN, apiReply, failedApiReply } from '../support/support';
import { allowBoundRefreshReplayAfterUnknownOutcome } from '../support/tracking';

const UNKNOWN_COMMIT = 'TRANSACTION_OUTCOME_UNKNOWN';

describe('device-bound refresh outcomes', () => {
  it('asks for sign-in after the server reports a replacement retry in progress', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      {
        status: 400,
        body: {
          error: 'invalid_dpop_proof',
          error_description: 'NATIVE_DPOP_RETRY_IN_PROGRESS',
        },
      },
    );

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(OAuthError);

    expect(refreshRequests(transport)).toHaveLength(3);
    expect(engine.snapshot.status).toBe('reauthRequired');
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBe(true);
  });

  it('deletes the family after invalid_grant on the one allowed replacement attempt', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      {
        status: 400,
        body: { error: 'invalid_grant' },
      },
    );

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(OAuthError);

    expect(refreshRequests(transport)).toHaveLength(3);
    expect(engine.snapshot.status).toBe('signedOut');
    expect(ports.credentials.value).toBeUndefined();
  });

  it('sends nothing more when the one allowed replacement answer is unknown too', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
    );

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(TransportError);

    expect(refreshRequests(transport)).toHaveLength(3);
    expect(engine.snapshot.status).toBe('reauthRequired');
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBe(true);
  });

  it('retries a bound bodiless 5xx once, then requires sign-in if still unknown', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      failedApiReply(502, UNKNOWN_COMMIT),
      failedApiReply(502, UNKNOWN_COMMIT),
    );

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(refreshRequests(transport)).toHaveLength(3);
    expect(engine.snapshot.status).toBe('reauthRequired');
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBe(true);
  });

  it('does not spend the bound retry on an authority failure known not to have rotated', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    enqueueBoundRefresh(transport, REFRESH_TOKEN, failedApiReply(503, 'AUTHORITY_UNAVAILABLE'));

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toMatchObject({ status: 503, code: 'AUTHORITY_UNAVAILABLE' });

    expect(refreshRequests(transport)).toHaveLength(2);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(parseStoredRecord(ports.credentials.value ?? '')?.tokens?.refreshToken).toBe(
      REFRESH_TOKEN,
    );
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBeUndefined();
  });

  it('does not retry a 429 unless its code proves the known throttle case', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    enqueueBoundRefresh(transport, REFRESH_TOKEN, failedApiReply(429, 'OTHER_RATE_CODE'));

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toMatchObject({ status: 429, code: 'OTHER_RATE_CODE' });

    expect(refreshRequests(transport)).toHaveLength(2);
    expect(engine.snapshot.status).toBe('reauthRequired');
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBe(true);
  });

  it('surfaces required device binding as its own refresh outcome', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    ports.clock.advance(270_000);
    transport.enqueue({
      status: 400,
      body: {
        error: 'invalid_dpop_proof',
        error_description: 'NATIVE_DPOP_REQUIRED',
      },
    });

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(DeviceBindingRequiredError);

    expect(refreshRequests(transport)).toHaveLength(1);
    expect(engine.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'deviceBindingRequired',
    });
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBe(true);
  });

  it('keeps an unavailable key retryable without destroying the bound session', async () => {
    const { engine, ports, transport, deviceKey } = await establishBoundSession();
    ports.clock.advance(270_000);
    deviceKey.signResult = { kind: 'unavailable' };

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toMatchObject({ reason: 'unavailable' });

    expect(engine.snapshot.status).toBe('signedIn');
    expect(parseStoredRecord(ports.credentials.value ?? '')?.tokens?.refreshToken).toBe(
      REFRESH_TOKEN,
    );
    expect(parseStoredRecord(ports.credentials.value ?? '')?.refreshInFlight).toBeUndefined();
    expect(refreshRequests(transport)).toHaveLength(0);

    deviceKey.signResult = undefined;
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      dpopTokenReply('access-1', 'refresh-1'),
      apiReply({ id: 'profile' }),
    );
    await engine.transport.request({ method: 'GET', path: '/api/user/profile' });
    expect(refreshRequests(transport)).toHaveLength(2);
  });

  it('requires sign-in after the key port cancels a refresh proof', async () => {
    const { engine, ports, transport, deviceKey } = await establishBoundSession();
    ports.clock.advance(270_000);
    deviceKey.publicKeyResult = { kind: 'cancelled' };

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(DeviceKeyAuthError);

    expect(refreshRequests(transport)).toHaveLength(0);
    expect(engine.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'deviceKeyInvalidated',
    });
    expect(parseStoredRecord(ports.credentials.value ?? '')?.tokens?.refreshToken).toBe(
      REFRESH_TOKEN,
    );
  });
});
