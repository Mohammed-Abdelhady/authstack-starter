import {
  REFRESH_SECOND_ROTATION_TOKEN,
  REFRESH_JOINED_TOKEN,
  REFRESH_AFTER_ABORT_TOKEN,
} from '../../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, TRANSPORT_FAILURE } from '@app/sdk';
import { PortAbortController } from '../../../src/runtime/abort-controller';
import { createAuthEngine } from '../../support/engine';
import {
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  apiReply,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../../support/support';

describe('refresh waiter aborts', () => {
  it('keeps one rotation when every in-flight waiter aborts before another request joins', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const started = new Deferred<void>();
    const answer = new Deferred<{ status: number; body: unknown }>();
    transport.enqueue(
      () => {
        started.resolve();
        return answer.promise;
      },
      oauthTokenReply('access-second-rotation', REFRESH_SECOND_ROTATION_TOKEN),
      apiReply({ id: 'joined' }),
      apiReply({ id: 'unexpected-second-replay' }),
    );
    const firstController = new PortAbortController();
    const secondController = new PortAbortController();
    const first = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
      signal: firstController.signal,
    });
    const second = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
      signal: secondController.signal,
    });
    await started.promise;
    firstController.abort();
    secondController.abort();
    await expect(first).rejects.toMatchObject({ reason: TRANSPORT_FAILURE.ABORTED });
    await expect(second).rejects.toMatchObject({ reason: TRANSPORT_FAILURE.ABORTED });
    const joined = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    answer.resolve(oauthTokenReply('access-joined', REFRESH_JOINED_TOKEN));

    await expect(joined).resolves.toMatchObject({ status: 200 });
    expect(refreshRequests(transport)).toHaveLength(1);
    expect(refreshRequests(transport)[0]?.body).toMatchObject({ refresh_token: REFRESH_TOKEN });
    expect(ports.timer.pending).toBe(0);
    engine.dispose();
  });

  it('keeps one rotation when a caller aborts immediately before a second request', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(
      oauthTokenReply('access-after-abort', REFRESH_AFTER_ABORT_TOKEN),
      oauthTokenReply('access-second-rotation', REFRESH_SECOND_ROTATION_TOKEN),
      apiReply({}),
      apiReply({}),
    );
    const controller = new PortAbortController();
    const aborted = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ reason: TRANSPORT_FAILURE.ABORTED });
    expect(refreshRequests(transport)).toHaveLength(0);
    const succeeding = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });

    await expect(succeeding).resolves.toMatchObject({ status: 200 });
    expect(refreshRequests(transport)).toHaveLength(1);
    expect(refreshRequests(transport)[0]?.body).toMatchObject({ refresh_token: REFRESH_TOKEN });
    expect(ports.timer.pending).toBe(0);
    engine.dispose();
  });
});

function refreshRequests(transport: ScriptedTransport) {
  return transport.sent.filter(
    ({ path, body }) =>
      path === '/api/oauth/token' &&
      typeof body === 'object' &&
      body !== null &&
      'grant_type' in body &&
      body.grant_type === 'refresh_token',
  );
}
