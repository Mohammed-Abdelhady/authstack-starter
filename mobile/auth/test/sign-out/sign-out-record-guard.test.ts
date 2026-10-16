import { createApiClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_READ_TIMEOUT_MS, CREDENTIAL_WRITE_TIMEOUT_MS } from '../../src/constants';
import { createSignOutOperation } from '../../src/sign-out/sign-out';
import { makeRefreshRecord } from '../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../src/runtime/runtime';
import { CONFIG, Deferred, ScriptedTransport, testPorts } from '../support/support';
import { watchTimerDrain } from '../support/timer-drain';
import { STORED_ACCESS_TOKEN, STORED_REFRESH_TOKEN } from '../support/token-values';

const INSTALL_DIGEST = 'sign-out-read-install';
const LINEAGE_ID = 'sign-out-read-lineage';

describe('sign-out storage discovered during the operation', () => {
  it('deletes the record read by sign-out after disposal', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.installDigest = INSTALL_DIGEST;
    const record = makeRefreshRecord(runtime, INSTALL_DIGEST, {
      accessToken: STORED_ACCESS_TOKEN,
      refreshToken: STORED_REFRESH_TOKEN,
      lineageId: LINEAGE_ID,
    });
    ports.credentials.value = JSON.stringify(record);

    const blockerStarted = new Deferred<void>();
    const releaseBlocker = new Deferred<void>();
    const writeQueued = new Deferred<void>();
    const revokeCompleted = new Deferred<void>();
    // The revocation leaves storage only after the server confirmed it.
    const slotCleared = new Deferred<void>();
    ports.credentials.afterDelete = () => slotCleared.resolve();
    // The stored-token read comes first; the next deadline of that length is the sign-out write's.
    let readDeadlineSeen = false;
    const timersDrained = watchTimerDrain(ports.timer, {
      onSchedule: (milliseconds) => {
        if (milliseconds === CREDENTIAL_READ_TIMEOUT_MS && !readDeadlineSeen)
          readDeadlineSeen = true;
        else if (milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS) writeQueued.resolve();
      },
    });
    transport.onResponse = (request) => {
      if (request.path === '/api/oauth/revoke') revokeCompleted.resolve();
    };
    const blocker = runtime.enqueueWrite(
      async () => {
        blockerStarted.resolve();
        await releaseBlocker.promise;
      },
      runtime.epoch,
      true,
    );
    await blockerStarted.promise;

    const signOut = createSignOutOperation(runtime, createApiClient(runtime.rawTransport))();
    await writeQueued.promise;
    runtime.dispose();
    releaseBlocker.resolve();
    await Promise.all([
      blocker,
      runtime.writeTail,
      revokeCompleted.promise,
      signOut,
      slotCleared.promise,
    ]);
    await timersDrained();

    expect(ports.credentials.value).toBeUndefined();
    expect(transport.sent.map(({ path, body }) => ({ path, body }))).toEqual([
      {
        path: '/api/oauth/revoke',
        body: { token: STORED_REFRESH_TOKEN, client_id: 'native-client' },
      },
    ]);
    expect(ports.timer.pending).toBe(0);
  });
});
