import { REFRESH_1_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, TRANSPORT_FAILURE, TransportError } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  REFRESH_TOKEN,
  ScriptedTransport,
  apiReply,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

const abortedSignal = {
  aborted: true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

describe('requests with an already-aborted signal', () => {
  it('does not start a refresh for the aborted request before a second request', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    let clockReads = 0;
    const readElapsed = ports.clock.monotonicTime.bind(ports.clock);
    ports.clock.monotonicTime = () => {
      clockReads += 1;
      return readElapsed();
    };
    transport.sent.length = 0;
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile' }));

    await expect(
      engine.transport.request({
        method: HTTP_METHOD.GET,
        path: '/api/user/profile',
        signal: abortedSignal,
      }),
    ).rejects.toMatchObject({ reason: TRANSPORT_FAILURE.ABORTED });
    expect(clockReads).toBe(0);
    const response = await engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });

    const refreshes = transport.sent.filter(
      ({ path, body }) =>
        path === '/api/oauth/token' &&
        typeof body === 'object' &&
        body !== null &&
        'grant_type' in body &&
        body.grant_type === 'refresh_token',
    );
    expect(response.status).toBe(200);
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.body).toMatchObject({ refresh_token: REFRESH_TOKEN });
  });

  it('rejects before sending when signed out', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    await expect(
      engine.transport.request({
        method: HTTP_METHOD.GET,
        path: '/api/user/profile',
        signal: abortedSignal,
      }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(transport.sent).toHaveLength(0);
  });

  it('rejects before sending when a valid token is in memory', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;

    await expect(
      engine.transport.request({
        method: HTTP_METHOD.GET,
        path: '/api/user/profile',
        signal: abortedSignal,
      }),
    ).rejects.toMatchObject({ reason: TRANSPORT_FAILURE.ABORTED });
    expect(transport.sent).toHaveLength(0);
  });
});
