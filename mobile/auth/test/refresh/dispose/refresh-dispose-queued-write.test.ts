import { REFRESH_BEFORE_TOKEN, REFRESH_AFTER_TOKEN } from '../../support/token-values';
import { createApiClient } from '@app/sdk';
import type { Transport } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import type { AbortSignalPort } from '../../../src';
import { CREDENTIAL_WRITE_TIMEOUT_MS } from '../../../src/constants';
import { AuthSessionError } from '../../../src/errors/errors';
import { createRefreshCoordinator } from '../../../src/refresh/refresh';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../../src/runtime/runtime';
import type { RuntimeTokens } from '../../../src/types/record';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  oauthTokenReply,
  testPorts,
} from '../../support/support';

describe('a rotated response queued behind a credential write', () => {
  it('persists the rotation after dispose only while its marker remains current', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const previous: RuntimeTokens = {
      accessToken: 'access-before',
      refreshToken: REFRESH_BEFORE_TOKEN,
      expiresAt: 0,
      version: 1,
      lineageId: 'queued-refresh-lineage',
    };
    runtime.installDigest = 'install-digest';
    runtime.tokens = previous;
    runtime.record = makeRefreshRecord(runtime, 'install-digest', previous);
    runtime.setState('signedIn', 'none');
    ports.credentials.value = JSON.stringify(runtime.record);
    const response = new Deferred<{ status: number; body: unknown }>();
    const refreshStarted = new Deferred<void>();
    const barrierStarted = new Deferred<void>();
    const releaseBarrier = new Deferred<void>();
    const rotatedWriteQueued = new Deferred<void>();
    let writeDeadlines = 0;
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS && ++writeDeadlines === 2)
        rotatedWriteQueued.resolve();
    };
    transport.enqueue(() => {
      refreshStarted.resolve();
      return response.promise;
    });
    const tracked: Transport<AbortSignalPort> = {
      request: (request) => {
        if (request.path === '/api/oauth/token')
          runtime.lastOAuthTokenSentAt = runtime.monotonicTime();
        return transport.request(request);
      },
    };
    const client = createApiClient(tracked);
    const coordinator = createRefreshCoordinator(runtime, client, client);
    const refreshing = coordinator.refresh();
    await refreshStarted.promise;
    const blocker = runtime.enqueueWrite(async () => {
      barrierStarted.resolve();
      await releaseBarrier.promise;
    }, runtime.epoch);
    await barrierStarted.promise;
    response.resolve(oauthTokenReply('access-after', REFRESH_AFTER_TOKEN));
    await rotatedWriteQueued.promise;

    runtime.dispose();
    releaseBarrier.resolve();

    await expect(refreshing).rejects.toBeInstanceOf(AuthSessionError);
    await blocker;

    expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_AFTER_TOKEN}"`);
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/revoke')).toHaveLength(0);
    expect(ports.timer.pending).toBe(0);
  });
});
