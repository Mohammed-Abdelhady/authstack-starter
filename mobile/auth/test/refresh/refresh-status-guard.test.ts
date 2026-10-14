import {
  REFRESH_1_TOKEN,
  REFRESH_SAMPLE_TOKEN,
  REFRESH_BEFORE_TOKEN,
  REFRESH_AFTER_TOKEN,
} from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { AuthSessionError } from '../../src';
import { createApiClient } from '@app/sdk';
import { AuthRuntime } from '../../src/runtime/runtime';
import { createRefreshCoordinator } from '../../src/refresh/refresh';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('refresh status guard', () => {
  it('keeps an in-memory session when restore is requested during a request', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const oldAnswer = new Deferred<{ status: number; body: unknown }>();
    transport.enqueue(
      () => oldAnswer.promise,
      oauthTokenReply('access-1', REFRESH_1_TOKEN),
      apiReply({ id: 'unexpected' }),
    );
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    ports.credentials.readResult = { kind: 'locked' };

    await engine.restore();
    oldAnswer.resolve(failedApiReply(401, 'SESSION_INVALID'));
    const result = await request;

    expect(result.status).toBe(200);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
  });

  it('refuses rotation when stored tokens remain but the session is storage-blocked', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.installDigest = 'install-digest';
    runtime.installTokens('access-token', REFRESH_SAMPLE_TOKEN, 1000, 300, 'status-guard-lineage');
    runtime.setState('storageBlocked', 'none');
    const client = createApiClient(runtime.rawTransport);
    const coordinator = createRefreshCoordinator(runtime, client);

    await expect(coordinator.refresh()).rejects.toBeInstanceOf(AuthSessionError);

    expect(transport.sent).toHaveLength(0);
    expect(runtime.snapshot).toMatchObject({ status: 'storageBlocked', operation: 'none' });
  });

  it('does not persist a refresh marker for a replaced token pair', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.installDigest = 'install-digest';
    runtime.installTokens('access-before', REFRESH_BEFORE_TOKEN, 1000, 300, 'status-guard-lineage');
    runtime.setState('signedIn', 'none');
    const coordinator = createRefreshCoordinator(runtime, createApiClient(runtime.rawTransport));
    const pending = coordinator.refresh();
    runtime.installTokens('access-after', REFRESH_AFTER_TOKEN, 1000, 300, 'replacement-lineage');

    await expect(pending).rejects.toBeInstanceOf(AuthSessionError);

    expect(ports.credentials.events).toEqual([]);
    expect(transport.sent).toHaveLength(0);
    expect(runtime.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
  });
});
