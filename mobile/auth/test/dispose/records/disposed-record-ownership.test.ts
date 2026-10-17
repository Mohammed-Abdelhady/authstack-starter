import {
  REFRESH_TARGET_TOKEN,
  REFRESH_SUCCESSOR_TOKEN,
  REFRESH_OLD_TOKEN,
  REFRESH_BEFORE_TOKEN,
  REFRESH_ROTATED_TOKEN,
} from '../../support/token-values';
import { createApiClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_DELETE_TIMEOUT_MS, CREDENTIAL_WRITE_TIMEOUT_MS } from '../../../src/constants';
import { classifyDisposedCredentialRecord } from '../../../src/storage/credential-record-store';
import {
  persistRotatedSessionAfterDispose,
  settleDisposedToken,
} from '../../../src/refresh/refresh-dispose';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../../src/runtime/runtime';
import { createSignOutOperation } from '../../../src/sign-out/sign-out';
import type { RuntimeTokens } from '../../../src/types/record';
import { revokedTokens } from '../../support/tracking';
import { CONFIG, Deferred, ScriptedTransport, testPorts } from '../../support/support';

const INSTALL_DIGEST = 'disposed-lineage-install';
const LINEAGE_A = 'lineage-a';

const CLASSIFICATION_RECORD = {
  schemaVersion: 1,
  serverBaseAddress: CONFIG.serverBaseAddress,
  environment: CONFIG.environment,
  clientId: CONFIG.clientId,
  installDigest: INSTALL_DIGEST,
  lineageId: LINEAGE_A,
  tokens: { refreshToken: REFRESH_TARGET_TOKEN },
};

describe('disposed credential ownership classification', () => {
  it.each([
    { name: 'the held token in its lineage', record: CLASSIFICATION_RECORD, expected: 'OWN_SAME' },
    {
      name: 'a stable later token in its lineage',
      record: { ...CLASSIFICATION_RECORD, tokens: { refreshToken: REFRESH_SUCCESSOR_TOKEN } },
      expected: 'OWN_OTHER',
    },
    {
      name: 'a later token in its lineage while its own refresh marker is present',
      record: {
        ...CLASSIFICATION_RECORD,
        tokens: { refreshToken: REFRESH_SUCCESSOR_TOKEN },
        refreshInFlight: true,
      },
      expected: 'OWN_OTHER',
    },
    {
      name: 'a different lineage',
      record: { ...CLASSIFICATION_RECORD, lineageId: 'lineage-b' },
      expected: 'FOREIGN',
    },
    {
      name: 'a record without lineage and a different token',
      record: {
        schemaVersion: 1,
        serverBaseAddress: CONFIG.serverBaseAddress,
        environment: CONFIG.environment,
        clientId: CONFIG.clientId,
        installDigest: INSTALL_DIGEST,
        tokens: { refreshToken: REFRESH_OLD_TOKEN },
      },
      expected: 'FOREIGN',
    },
    {
      name: 'a record without lineage and the exact token',
      record: {
        schemaVersion: 1,
        serverBaseAddress: CONFIG.serverBaseAddress,
        environment: CONFIG.environment,
        clientId: CONFIG.clientId,
        installDigest: INSTALL_DIGEST,
        tokens: { refreshToken: REFRESH_TARGET_TOKEN },
      },
      expected: 'FOREIGN',
    },
    { name: 'missing storage', expected: 'EMPTY' },
    { name: 'two unreadable storage results', readResult: 'unavailable', expected: 'UNREADABLE' },
  ] as const)('classifies $name', async ({ record, readResult, expected }) => {
    const ports = testPorts(new ScriptedTransport());
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.installDigest = INSTALL_DIGEST;
    if (record) ports.credentials.value = JSON.stringify(record);
    if (readResult === 'unavailable') ports.credentials.readResult = { kind: 'unavailable' };

    await expect(
      classifyDisposedCredentialRecord(runtime, {
        kind: 'session',
        installDigest: INSTALL_DIGEST,
        refreshToken: REFRESH_TARGET_TOKEN,
        lineageId: LINEAGE_A,
      }),
    ).resolves.toBe(expected);
    if (expected === 'UNREADABLE')
      expect(ports.credentials.events.filter((event) => event === 'read')).toHaveLength(2);
    expect(ports.timer.pending).toBe(0);
  });
});
describe('disposed credential ownership', () => {
  it('sends one revoke when two disposed cleanup paths claim the same token', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const runtime = disposedMarkerRuntime(ports);
    ports.credentials.value = undefined;
    const client = createApiClient(runtime.rawTransport);

    await Promise.all([
      settleDisposedToken(runtime, client, INSTALL_DIGEST, LINEAGE_A, 'late-refresh'),
      settleDisposedToken(runtime, client, INSTALL_DIGEST, LINEAGE_A, 'late-refresh'),
    ]);

    expect(revokedTokens(transport)).toEqual(['late-refresh']);
    expect(ports.timer.pending).toBe(0);
  });

  it('leaves a late refresh marker for restart recovery instead of deleting the live session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const tokens: RuntimeTokens = {
      accessToken: 'marker-access',
      refreshToken: 'marker-refresh',
      expiresAt: 0,
      version: 1,
      lineageId: LINEAGE_A,
    };
    runtime.installDigest = INSTALL_DIGEST;
    runtime.tokens = tokens;
    const stableRecord = makeRefreshRecord(runtime, INSTALL_DIGEST, tokens);
    runtime.record = stableRecord;
    ports.credentials.value = JSON.stringify(stableRecord);
    runtime.setState('signedIn', 'refreshing');
    const markerWriteStarted = new Deferred<void>();
    const releaseMarkerWrite = new Deferred<void>();
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes('"refreshInFlight":true')) return;
      markerWriteStarted.resolve();
      await releaseMarkerWrite.promise;
    };
    const marker = makeRefreshRecord(runtime, INSTALL_DIGEST, tokens, true);
    const pendingWrite = runtime.replaceRecord(marker, runtime.epoch).catch(() => false);
    await markerWriteStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    runtime.dispose();
    releaseMarkerWrite.resolve();
    await pendingWrite;
    await runtime.writeTail;

    expect(ports.credentials.value).toContain('"refreshInFlight":true');
    expect(ports.credentials.value).toContain('marker-refresh');
    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.timer.pending).toBe(0);
  });

  it('does not let a late marker correction replace a timed-out sign-out delete', async () => {
    const transport = new ScriptedTransport();
    const revokeCompleted = new Deferred<void>();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    transport.onResponse = (request) => {
      if (request.path === '/api/oauth/revoke') revokeCompleted.resolve();
    };
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const tokens: RuntimeTokens = {
      accessToken: 'marker-access',
      refreshToken: 'marker-refresh',
      expiresAt: 0,
      version: 1,
      lineageId: LINEAGE_A,
    };
    runtime.installDigest = INSTALL_DIGEST;
    runtime.tokens = tokens;
    runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, tokens);
    runtime.setState('signedIn', 'none');
    ports.credentials.value = JSON.stringify(runtime.record);
    const marker = makeRefreshRecord(runtime, INSTALL_DIGEST, tokens, true);
    const markerWriteStarted = new Deferred<void>();
    const releaseMarkerWrite = new Deferred<void>();
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes('"refreshInFlight":true')) return;
      markerWriteStarted.resolve();
      await releaseMarkerWrite.promise;
    };
    const markerWrite = runtime.replaceRecord(marker, runtime.epoch).catch(() => false);
    await markerWriteStarted.promise;

    const signOut = createSignOutOperation(runtime, createApiClient(runtime.rawTransport))();
    runtime.dispose();
    await expect(signOut).resolves.toEqual({ kind: 'disposed' });
    // The sign-out write waits behind the marker; past its deadline it revokes without storing.
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await revokeCompleted.promise;
    ports.timer.fireDelay(CREDENTIAL_DELETE_TIMEOUT_MS);
    releaseMarkerWrite.resolve();
    await markerWrite;
    await runtime.writeTail;

    expect(revokedTokens(transport)).toEqual(['marker-refresh']);
    expect(ports.credentials.value).toBeUndefined();
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(0);
    expect(ports.timer.pending).toBe(0);
  });

  it('retries an unreadable ownership check before revoking a saved rotated token', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const runtime = disposedMarkerRuntime(ports);
    let readCalls = 0;
    const read = ports.credentials.read.bind(ports.credentials);
    ports.credentials.read = async () => {
      readCalls += 1;
      if (readCalls === 2) throw new Error('temporary keychain read failure');
      return read();
    };
    ports.credentials.afterReplace = (value) => {
      if (value.includes(`"refreshToken":"${REFRESH_ROTATED_TOKEN}"`))
        throw new Error('store reported a post-write failure');
    };

    await persistRotatedSessionAfterDispose(
      runtime,
      createApiClient(runtime.rawTransport),
      INSTALL_DIGEST,
      REFRESH_BEFORE_TOKEN,
      { accessToken: 'access-rotated', refreshToken: REFRESH_ROTATED_TOKEN, lineageId: LINEAGE_A },
    );

    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.credentials.value).toContain(REFRESH_ROTATED_TOKEN);
    expect(readCalls).toBe(3);
    expect(ports.timer.pending).toBe(0);
  });

  it('revokes after two unreadable checks and queues a guarded deletion', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const runtime = disposedMarkerRuntime(ports);
    let readCalls = 0;
    const read = ports.credentials.read.bind(ports.credentials);
    ports.credentials.read = async () => {
      readCalls += 1;
      if (readCalls === 2 || readCalls === 3) throw new Error('temporary keychain read failure');
      return read();
    };
    ports.credentials.afterReplace = (value) => {
      if (value.includes(`"refreshToken":"${REFRESH_ROTATED_TOKEN}"`))
        throw new Error('store reported a post-write failure');
    };

    await persistRotatedSessionAfterDispose(
      runtime,
      createApiClient(runtime.rawTransport),
      INSTALL_DIGEST,
      REFRESH_BEFORE_TOKEN,
      { accessToken: 'access-rotated', refreshToken: REFRESH_ROTATED_TOKEN, lineageId: LINEAGE_A },
    );
    await runtime.writeTail;

    expect(revokedTokens(transport)).toEqual([REFRESH_ROTATED_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
    expect(readCalls).toBe(4);
    expect(ports.timer.pending).toBe(0);
  });
});

function disposedMarkerRuntime(ports: ReturnType<typeof testPorts>): AuthRuntime {
  const runtime = new AuthRuntime(CONFIG, ports);
  const tokens: RuntimeTokens = {
    accessToken: 'access-before',
    refreshToken: REFRESH_BEFORE_TOKEN,
    expiresAt: 0,
    version: 1,
    lineageId: LINEAGE_A,
  };
  runtime.installDigest = INSTALL_DIGEST;
  runtime.tokens = tokens;
  runtime.record = {
    ...makeRefreshRecord(runtime, INSTALL_DIGEST, tokens, true),
    lineageId: LINEAGE_A,
  };
  ports.credentials.value = JSON.stringify(runtime.record);
  runtime.setState('signedIn', 'refreshing');
  runtime.dispose();
  return runtime;
}
