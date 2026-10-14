import { REFRESH_TO_REVOKE_TOKEN } from '../../support/token-values';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_WRITE_TIMEOUT_MS } from '../../../src/constants';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../../src/runtime/runtime';
import type { RuntimeTokens } from '../../../src/types/record';
import { CONFIG, Deferred, ScriptedTransport, testPorts } from '../../support/support';

describe('abandoned credential writes after disposal', () => {
  it('removes an OWN_SAME record after its abandoned write lands', async () => {
    const ports = testPorts(new ScriptedTransport());
    const runtime = new AuthRuntime(CONFIG, ports);
    const tokens: RuntimeTokens = {
      accessToken: 'access-to-revoke',
      refreshToken: REFRESH_TO_REVOKE_TOKEN,
      expiresAt: 0,
      version: 1,
      lineageId: 'revoke-intent-lineage',
    };
    runtime.installDigest = 'revoke-intent-install';
    runtime.tokens = tokens;
    const record = makeRefreshRecord(runtime, 'revoke-intent-install', tokens);
    runtime.record = record;
    ports.credentials.value = JSON.stringify(record);
    runtime.setState('signedIn', 'none');
    runtime.dispose();
    runtime.markDisposedRevocationIntent(tokens.refreshToken);

    const writeStarted = new Deferred<void>();
    const releaseWrite = new Deferred<void>();
    ports.credentials.beforeReplace = async () => {
      writeStarted.resolve();
      await releaseWrite.promise;
    };
    const guard = {
      kind: 'session' as const,
      installDigest: 'revoke-intent-install',
      refreshToken: REFRESH_TO_REVOKE_TOKEN,
      lineageId: 'revoke-intent-lineage',
    };
    const abandonedWrite = runtime.replaceRecord(record, runtime.epoch, { kind: 'delete' }, guard);
    await writeStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await expect(abandonedWrite).rejects.toMatchObject({
      operation: 'credentials.replace',
      reason: 'timedOut',
    });
    releaseWrite.resolve();
    await runtime.writeTail;

    expect(ports.credentials.value).toBeUndefined();
    expect(ports.credentials.events.filter((event) => event === 'delete:done')).toHaveLength(1);
    expect(ports.timer.pending).toBe(0);
  });

  it('keeps a pre-dispose abandoned marker when both ownership reads are unavailable', async () => {
    const ports = testPorts(new ScriptedTransport());
    const runtime = new AuthRuntime(CONFIG, ports);
    const tokens: RuntimeTokens = {
      accessToken: 'access-to-revoke',
      refreshToken: REFRESH_TO_REVOKE_TOKEN,
      expiresAt: 0,
      version: 1,
      lineageId: 'revoke-intent-lineage',
    };
    runtime.installDigest = 'revoke-intent-install';
    runtime.tokens = tokens;
    const record = makeRefreshRecord(runtime, 'revoke-intent-install', tokens, true);
    runtime.record = record;
    ports.credentials.value = JSON.stringify(record);
    runtime.setState('signedIn', 'none');
    const expectedEpoch = runtime.epoch;
    const writeStarted = new Deferred<void>();
    const releaseWrite = new Deferred<void>();
    ports.credentials.beforeReplace = async () => {
      writeStarted.resolve();
      await releaseWrite.promise;
    };
    const guard = {
      kind: 'refresh' as const,
      installDigest: 'revoke-intent-install',
      refreshToken: REFRESH_TO_REVOKE_TOKEN,
      lineageId: 'revoke-intent-lineage',
    };
    const abandonedWrite = runtime.replaceRecord(record, expectedEpoch, { kind: 'delete' }, guard);

    await writeStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await expect(abandonedWrite).rejects.toMatchObject({
      operation: 'credentials.replace',
      reason: 'timedOut',
    });
    runtime.dispose();
    const read = ports.credentials.read.bind(ports.credentials);
    let readCalls = 0;
    ports.credentials.read = async () => {
      readCalls += 1;
      if (readCalls <= 2) throw new Error('temporary keychain read failure');
      return read();
    };
    releaseWrite.resolve();
    await runtime.writeTail;

    expect(ports.credentials.value).toBe(JSON.stringify(record));
    expect(readCalls).toBe(2);
    expect(ports.credentials.events.filter((event) => event === 'delete:start')).toHaveLength(0);
    expect(ports.timer.pending).toBe(0);
  });
});
