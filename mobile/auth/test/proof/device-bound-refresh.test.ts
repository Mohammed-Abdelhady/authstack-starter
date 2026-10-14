import { REFRESH_1_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { parseStoredRecord } from '../../src/storage/persistence';
import {
  CHALLENGE_NONCE,
  dpopTokenReply,
  enqueueBoundRefresh,
  establishBoundSession,
  proofNonces,
  refreshRequests,
  requestPayload,
} from '../support/device-bound-support';
import { allowBoundRefreshReplayAfterUnknownOutcome } from '../support/tracking';
import { REFRESH_TOKEN, apiReply, failedApiReply } from '../support/support';

describe('device-bound refresh', () => {
  it('answers the challenge with the same token and keeps lineage and thumbprint across rotation', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    const before = parseStoredRecord(ports.credentials.value ?? '');
    ports.clock.advance(270_000);
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      dpopTokenReply('access-1', REFRESH_1_TOKEN),
      apiReply({ id: 'profile' }),
    );

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    const requests = refreshRequests(transport);
    const proofs = requests.map(({ headers }) => requestPayload(headers?.['DPoP'] ?? ''));
    const stored = parseStoredRecord(ports.credentials.value ?? '');
    expect(requests.map(({ body }) => body)).toMatchObject([
      { refresh_token: REFRESH_TOKEN },
      { refresh_token: REFRESH_TOKEN },
    ]);
    expect(proofs.map(({ htu, nonce }) => ({ htu, nonce }))).toEqual([
      { htu: 'https://api.example.test/api/oauth/token', nonce: '' },
      { htu: 'https://api.example.test/api/oauth/token', nonce: CHALLENGE_NONCE },
    ]);
    expect(proofs[0]?.ath).toEqual(expect.any(String));
    expect(proofs[1]?.ath).toBe(proofs[0]?.ath);
    expect(proofs[0]?.jti).not.toBe(proofs[1]?.jti);
    expect(stored?.lineageId).toBe('BAQEBAQEBAQEBAQEBAQEBA');
    expect(stored?.lineageId).toBe(before?.lineageId);
    expect(stored?.proofKeyThumbprint).toBe(before?.proofKeyThumbprint);
    expect(stored?.tokens?.refreshToken).toBe(REFRESH_1_TOKEN);
  });

  it.each([
    ['a lost answer', new TransportError(TRANSPORT_FAILURE.NO_RESPONSE)],
    ['a 502', failedApiReply(502, 'TRANSACTION_OUTCOME_UNKNOWN')],
  ] as const)(
    'replays the token once after a challenge then %s, with a fresh proof on the nonce it holds',
    async (_name, unknownOutcome) => {
      const { engine, ports, transport } = await establishBoundSession();
      const before = parseStoredRecord(ports.credentials.value ?? '');
      ports.clock.advance(270_000);
      allowBoundRefreshReplayAfterUnknownOutcome(REFRESH_TOKEN);
      enqueueBoundRefresh(
        transport,
        REFRESH_TOKEN,
        unknownOutcome,
        dpopTokenReply('access-1', REFRESH_1_TOKEN),
        apiReply({ id: 'profile' }),
      );

      await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

      const requests = refreshRequests(transport);
      const stored = parseStoredRecord(ports.credentials.value ?? '');
      const proofIds = requests.map(({ headers }) => requestPayload(headers?.['DPoP'] ?? '').jti);
      expect(requests.map(({ body }) => body)).toMatchObject([
        { refresh_token: REFRESH_TOKEN },
        { refresh_token: REFRESH_TOKEN },
        { refresh_token: REFRESH_TOKEN },
      ]);
      expect(proofNonces(requests)).toEqual(['', CHALLENGE_NONCE, CHALLENGE_NONCE]);
      expect(new Set(proofIds).size).toBe(3);
      expect(stored?.lineageId).toBe(before?.lineageId);
      expect(stored?.tokens?.refreshToken).toBe(REFRESH_1_TOKEN);
      expect(engine.snapshot.status).toBe('signedIn');
    },
  );

  it('does not replay a lost answer for an unbound session', async () => {
    const { createAuthEngine } = await import('../support/engine');
    const { CONFIG, ScriptedTransport, testPorts, establishSession } =
      await import('../support/support');
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(TransportError);

    expect(refreshRequests(transport)).toHaveLength(1);
    expect(engine.snapshot.status).toBe('reauthRequired');
  });
});
