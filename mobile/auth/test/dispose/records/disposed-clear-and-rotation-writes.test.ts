import { REFRESH_ROTATED_TOKEN, REFRESH_CURRENT_TOKEN } from '../../support/token-values';
import { ApiError, createApiClient } from '@app/sdk';
import type { TransportResponse } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_UNAVAILABLE_CODE,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  RATE_LIMIT_EXCEEDED_CODE,
} from '../../../src/constants';
import { AuthSessionError } from '../../../src/errors/errors';
import { createRefreshCoordinator } from '../../../src/refresh/refresh';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../../src/runtime/runtime';
import type { RuntimeTokens } from '../../../src/types/record';
import { revokedTokens } from '../../support/tracking';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  failedApiReply,
  oauthTokenReply,
  testPorts,
} from '../../support/support';

const LINEAGE_ID = 'lineage-disposed-write';
const INSTALL_DIGEST = 'install-disposed-write';

describe('disposed refresh writes that time out and later land', () => {
  it('keeps a rotated token when the settle read waits behind its write', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials.serializedOperations = true;
    const runtime = makeRuntime(ports);
    const response = new Deferred<TransportResponse>();
    const requestStarted = new Deferred<void>();
    const writeStarted = new Deferred<void>();
    const releaseWrite = new Deferred<void>();
    const settleReadQueued = new Deferred<void>();
    let readsQueued = 0;
    let readsCompleted = 0;
    let settleReadCompleted = false;
    ports.credentials.onOperationQueued = (operation) => {
      if (operation === 'read' && ++readsQueued === 2) settleReadQueued.resolve();
    };
    ports.credentials.afterRead = () => {
      readsCompleted += 1;
      if (readsCompleted === 2) settleReadCompleted = true;
    };
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes(REFRESH_ROTATED_TOKEN)) return;
      writeStarted.resolve();
      await releaseWrite.promise;
    };
    transport.enqueue(() => {
      requestStarted.resolve();
      return response.promise;
    });
    const client = createApiClient(runtime.rawTransport);
    const refresh = createRefreshCoordinator(runtime, client, client);
    const pending = refresh.refresh();

    await requestStarted.promise;
    runtime.dispose();
    response.resolve(oauthTokenReply('access-rotated', REFRESH_ROTATED_TOKEN));
    await writeStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await settleReadQueued.promise;
    expect(settleReadCompleted).toBe(false);
    releaseWrite.resolve();
    await expect(pending).rejects.toBeInstanceOf(AuthSessionError);
    await runtime.writeTail;

    expect(settleReadCompleted).toBe(true);
    expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_ROTATED_TOKEN}"`);
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.timer.pending).toBe(0);
  });

  it.each([
    ['rate limited', failedApiReply(429, RATE_LIMIT_EXCEEDED_CODE), 429, RATE_LIMIT_EXCEEDED_CODE],
    [
      'authority unavailable',
      failedApiReply(503, AUTHORITY_UNAVAILABLE_CODE),
      503,
      AUTHORITY_UNAVAILABLE_CODE,
    ],
  ] as const)(
    'keeps the unrotated session when its clear write later lands after %s',
    async (_name, answer, status, code) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      ports.credentials.serializedOperations = true;
      const runtime = makeRuntime(ports);
      const response = new Deferred<TransportResponse>();
      const requestStarted = new Deferred<void>();
      const clearWriteStarted = new Deferred<void>();
      const releaseWrite = new Deferred<void>();
      const correctionReadQueued = new Deferred<void>();
      let readsQueued = 0;
      ports.credentials.onOperationQueued = (operation) => {
        if (operation === 'read' && ++readsQueued === 1) correctionReadQueued.resolve();
      };
      ports.credentials.beforeReplace = async (value) => {
        if (!value.includes(REFRESH_CURRENT_TOKEN) || value.includes('"refreshInFlight":true'))
          return;
        clearWriteStarted.resolve();
        await releaseWrite.promise;
      };
      transport.enqueue(() => {
        requestStarted.resolve();
        return response.promise;
      });
      const client = createApiClient(runtime.rawTransport);
      const refresh = createRefreshCoordinator(runtime, client, client);
      const pending = refresh.refresh();

      await requestStarted.promise;
      response.resolve(answer);
      await clearWriteStarted.promise;
      runtime.dispose();
      ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
      releaseWrite.resolve();
      await expect(pending).rejects.toBeInstanceOf(ApiError);
      await expect(pending).rejects.toMatchObject({ status, code });
      await correctionReadQueued.promise;
      await runtime.writeTail;

      expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_CURRENT_TOKEN}"`);
      expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
      expect(revokedTokens(transport)).toEqual([]);
      expect(ports.timer.pending).toBe(0);
    },
  );
});

function makeRuntime(ports: ReturnType<typeof testPorts>): AuthRuntime {
  const runtime = new AuthRuntime(CONFIG, ports);
  const tokens: RuntimeTokens = {
    accessToken: 'access-current',
    refreshToken: REFRESH_CURRENT_TOKEN,
    expiresAt: 0,
    version: 1,
    lineageId: LINEAGE_ID,
  };
  runtime.installDigest = INSTALL_DIGEST;
  runtime.tokens = tokens;
  runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, tokens);
  runtime.setState('signedIn', 'none');
  ports.credentials.value = JSON.stringify(runtime.record);
  return runtime;
}
