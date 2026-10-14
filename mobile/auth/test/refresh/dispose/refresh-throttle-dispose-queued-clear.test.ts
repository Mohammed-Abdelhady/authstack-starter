import { REFRESH_CURRENT_TOKEN } from '../../support/token-values';
import { ApiError, createApiClient } from '@app/sdk';
import type { Transport, TransportResponse } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import type { AbortSignalPort } from '../../../src';
import {
  AUTHORITY_UNAVAILABLE_CODE,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  RATE_LIMIT_EXCEEDED_CODE,
} from '../../../src/constants';
import { createRefreshCoordinator } from '../../../src/refresh/refresh';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../../src/runtime/runtime';
import type { RuntimeTokens } from '../../../src/types/record';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  failedApiReply,
  testPorts,
} from '../../support/support';
import { revokedTokens } from '../../support/tracking';

describe('a queued throttle marker clear across dispose', () => {
  it.each([
    [429, RATE_LIMIT_EXCEEDED_CODE],
    [503, AUTHORITY_UNAVAILABLE_CODE],
  ] as const)(
    'settles the stable record after %i %s when dispose wins the clear write',
    async (status, code) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      ports.credentials.serializedOperations = true;
      const runtime = new AuthRuntime(CONFIG, ports);
      const tokens: RuntimeTokens = {
        accessToken: 'access-current',
        refreshToken: REFRESH_CURRENT_TOKEN,
        expiresAt: 0,
        version: 1,
        lineageId: 'throttle-dispose-lineage',
      };
      runtime.installDigest = 'throttle-dispose-install';
      runtime.tokens = tokens;
      runtime.record = makeRefreshRecord(runtime, 'throttle-dispose-install', tokens);
      ports.credentials.value = JSON.stringify(runtime.record);
      runtime.setState('signedIn', 'none');

      const markerWritten = new Deferred<void>();
      const blockerStarted = new Deferred<void>();
      const releaseBlocker = new Deferred<void>();
      const refreshStarted = new Deferred<void>();
      const answer = new Deferred<TransportResponse>();
      const clearWriteQueued = new Deferred<void>();
      let writeDeadlines = 0;
      ports.credentials.afterReplace = (value) => {
        if (value.includes('"refreshInFlight":true')) markerWritten.resolve();
      };
      ports.timer.onSchedule = (milliseconds) => {
        if (milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS && ++writeDeadlines === 2)
          clearWriteQueued.resolve();
      };
      transport.enqueue(() => {
        refreshStarted.resolve();
        return answer.promise;
      });
      const tracked: Transport<AbortSignalPort> = {
        request: (request) => {
          if (request.path === '/api/oauth/token') {
            runtime.lastOAuthTokenSentAt = runtime.monotonicTime();
            runtime.oauthTokenRequestSent = true;
          }
          return transport.request(request);
        },
      };
      const client = createApiClient(tracked);
      const coordinator = createRefreshCoordinator(runtime, client, client);
      const pending = coordinator.refresh();
      await markerWritten.promise;
      const blocker = runtime.enqueueWrite(async () => {
        blockerStarted.resolve();
        await releaseBlocker.promise;
      }, runtime.epoch);
      await blockerStarted.promise;
      await refreshStarted.promise;
      answer.resolve(failedApiReply(status, code));
      await clearWriteQueued.promise;

      runtime.dispose();
      releaseBlocker.resolve();
      await expect(pending).rejects.toBeInstanceOf(ApiError);
      await blocker;
      await runtime.writeTail;

      expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_CURRENT_TOKEN}"`);
      expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
      expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
      expect(revokedTokens(transport)).toEqual([]);
      expect(ports.timer.pending).toBe(0);
    },
  );
});
