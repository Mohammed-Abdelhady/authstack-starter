import { ACCESS_SECRET_TOKEN, REFRESH_SECRET_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { AuthRuntime } from '../../src/runtime/runtime';
import { CREDENTIAL_DELETE_TIMEOUT_MS } from '../../src/constants';
import { CONFIG, Deferred, ScriptedTransport, testPorts } from '../support/support';

describe('runtime disposal', () => {
  it('releases the in-memory token pair when the engine is disposed', () => {
    const runtime = new AuthRuntime(CONFIG, testPorts(new ScriptedTransport()));
    runtime.installTokens(ACCESS_SECRET_TOKEN, REFRESH_SECRET_TOKEN, 1000, 300, 'dispose-lineage');
    runtime.setState('signedIn', 'none');

    runtime.dispose();

    expect(runtime.tokens).toBeUndefined();
    expect(runtime.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });

  it('clears pending authorization material and records that its deletion is owed', async () => {
    const ports = testPorts(new ScriptedTransport());
    const deleteStarted = new Deferred<void>();
    const finishDelete = new Deferred<void>();
    const deleted = new Deferred<void>();
    const timerCancelled = new Deferred<void>();
    ports.credentials.beforeDelete = () => {
      deleteStarted.resolve();
      return finishDelete.promise;
    };
    ports.credentials.afterDelete = () => deleted.resolve();
    ports.timer.onCancel = (milliseconds) => {
      if (milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS) timerCancelled.resolve();
    };
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.record = {
      schemaVersion: 1,
      serverBaseAddress: CONFIG.serverBaseAddress,
      environment: CONFIG.environment,
      clientId: CONFIG.clientId,
      installDigest: 'install-digest',
      transaction: {
        verifier: 'verifier-secret',
        state: 'state-secret',
        returnAddress: CONFIG.redirectUri,
        createdAt: 1_800_000_000_000,
        expiresAt: 1_800_000_360_000,
        operationId: 'operation-1',
      },
    };
    runtime.installDigest = 'install-digest';
    ports.credentials.value = JSON.stringify(runtime.record);
    runtime.setState('signedOut', 'authorizing');

    runtime.dispose();
    await deleteStarted.promise;

    expect(runtime.record).toBeUndefined();
    expect(runtime.deleteOwed).toBe(true);

    finishDelete.resolve();
    await deleted.promise;
    await timerCancelled.promise;

    expect(runtime.record).toBeUndefined();
    expect(runtime.deleteOwed).toBe(false);
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
  });
});
