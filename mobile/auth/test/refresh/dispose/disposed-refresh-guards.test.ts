import {
  REFRESH_OLD_TOKEN,
  REFRESH_NEXT_TOKEN,
  REFRESH_OTHER_TOKEN,
  REFRESH_SUCCESSOR_TOKEN,
} from '../../support/token-values';
import { ApiError, createApiClient, OAuthError } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_UNAVAILABLE_CODE,
  CREDENTIAL_DELETE_TIMEOUT_MS,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  RATE_LIMIT_EXCEEDED_CODE,
} from '../../../src/constants';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../../src/runtime/runtime';
import {
  persistRotatedSessionAfterDispose,
  settleDisposedRefreshFailure,
} from '../../../src/refresh/refresh-dispose';
import type { RuntimeTokens } from '../../../src/types/record';
import { CONFIG, Deferred, ScriptedTransport, testPorts } from '../../support/support';

const INSTALL_DIGEST = 'device-digest';
const LINEAGE_ID = 'disposed-guard-lineage';
const TOKENS: RuntimeTokens = {
  accessToken: 'access-old',
  refreshToken: REFRESH_OLD_TOKEN,
  expiresAt: 0,
  version: 1,
  lineageId: LINEAGE_ID,
};

function disposedRuntime() {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const runtime = new AuthRuntime(CONFIG, ports);
  runtime.installDigest = INSTALL_DIGEST;
  runtime.tokens = TOKENS;
  runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, TOKENS, true);
  runtime.lastOAuthTokenSentAt = 1000;
  runtime.oauthTokenRequestSent = true;
  ports.credentials.value = JSON.stringify(runtime.record);
  runtime.setState('signedIn', 'refreshing');
  runtime.dispose();
  transport.respond = async ({ path }) => ({
    status: 200,
    body: path.endsWith('/revoke') ? {} : {},
  });
  return { runtime, ports, transport, client: createApiClient(transport) };
}

describe('disposed refresh storage guards', () => {
  it('revokes a late rotation when only the sent predecessor marker remains', async () => {
    const { runtime, ports, transport, client } = disposedRuntime();
    const marker = ports.credentials.value;
    ports.credentials.beforeReplace = (value) =>
      value.includes(REFRESH_NEXT_TOKEN)
        ? Promise.reject(new Error('secure storage rejected the rotation'))
        : Promise.resolve();

    await persistRotatedSessionAfterDispose(runtime, client, INSTALL_DIGEST, REFRESH_OLD_TOKEN, {
      accessToken: 'access-next',
      refreshToken: REFRESH_NEXT_TOKEN,
      lineageId: LINEAGE_ID,
    });

    expect(ports.credentials.value).toBe(marker);
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/revoke')).toHaveLength(1);
    expect(transport.sent.find(({ path }) => path === '/api/oauth/revoke')?.body).toMatchObject({
      token: REFRESH_NEXT_TOKEN,
    });
    expect(ports.credentials.value).toContain('"refreshInFlight":true');
    expect(ports.timer.pending).toBe(0);
  });

  it('does not store a rotation after its disposed write deadline expires during the guard read', async () => {
    const { runtime, ports } = disposedRuntime();
    const marker = ports.credentials.value;
    if (!marker) throw new Error('Expected a stored refresh marker');
    const guardReadStarted = new Deferred<void>();
    const releaseGuardRead = new Deferred<void>();
    ports.credentials.read = async () => {
      guardReadStarted.resolve();
      await releaseGuardRead.promise;
      return { kind: 'found', value: marker };
    };
    const writeDeadline = new Deferred<() => void>();
    const originalAfter = ports.timer.after.bind(ports.timer);
    let captured = false;
    ports.timer.after = (milliseconds, callback) => {
      if (milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS && !captured) {
        captured = true;
        writeDeadline.resolve(callback);
      }
      return originalAfter(milliseconds, callback);
    };
    const nextRecord = makeRefreshRecord(runtime, INSTALL_DIGEST, {
      accessToken: 'access-next',
      refreshToken: REFRESH_NEXT_TOKEN,
      lineageId: LINEAGE_ID,
    });
    const replacing = runtime.replaceRecord(
      nextRecord,
      runtime.epoch,
      { kind: 'delete' },
      {
        kind: 'refresh',
        installDigest: INSTALL_DIGEST,
        refreshToken: REFRESH_OLD_TOKEN,
        lineageId: LINEAGE_ID,
      },
    );

    await guardReadStarted.promise;
    (await writeDeadline.promise)();
    await expect(replacing).rejects.toMatchObject({ operation: 'credentials.replace' });
    releaseGuardRead.resolve();
    await runtime.writeTail;

    expect(ports.credentials.value).toBe(marker);
    expect(ports.credentials.events.filter((event) => event === 'replace:start')).toHaveLength(0);
    expect(ports.timer.pending).toBe(0);
  });

  it('does not run a queued delete after its credential deadline expires', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.installDigest = INSTALL_DIGEST;
    runtime.tokens = TOKENS;
    runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, TOKENS, true);
    ports.credentials.value = JSON.stringify(runtime.record);
    runtime.setState('signedIn', 'none');
    const marker = ports.credentials.value;
    const blockedWrite = new Deferred<void>();
    const priorWrite = runtime.enqueueWrite(() => blockedWrite.promise, runtime.epoch, true);
    const deleting = runtime.deleteRecordGuarded(runtime.epoch, {
      kind: 'refresh',
      installDigest: INSTALL_DIGEST,
      refreshToken: TOKENS.refreshToken,
      lineageId: LINEAGE_ID,
    });

    ports.timer.fireDelay(CREDENTIAL_DELETE_TIMEOUT_MS);
    await expect(deleting).rejects.toMatchObject({ operation: 'credentials.delete' });
    blockedWrite.resolve();
    await priorWrite;
    await runtime.writeTail;

    expect(ports.credentials.value).toBe(marker);
    expect(ports.credentials.events.filter((event) => event === 'delete:start')).toHaveLength(0);
    expect(ports.timer.pending).toBe(0);
  });

  it.each([
    ['the sent predecessor in the same lineage', 'stable', true],
    ['marker for another token in the same lineage', 'differentToken', false],
    ['different server', 'differentServer', true],
    ['different client', 'differentClient', true],
    ['different environment', 'differentEnvironment', true],
    ['different install', 'differentInstall', true],
    ['unavailable read', 'readUnavailable', true],
    ['rejected read', 'readRejected', true],
  ] as const)('classifies a late rotation against storage at %s', async (_case, kind, revoke) => {
    const { runtime, ports, transport, client } = disposedRuntime();
    const original = ports.credentials.value;
    if (!original) throw new Error('Expected a stored refresh marker');
    if (kind === 'stable') {
      ports.credentials.value = JSON.stringify(makeRefreshRecord(runtime, INSTALL_DIGEST, TOKENS));
    } else if (kind === 'differentToken') {
      ports.credentials.value = JSON.stringify(
        makeRefreshRecord(
          runtime,
          INSTALL_DIGEST,
          { ...TOKENS, refreshToken: REFRESH_OTHER_TOKEN },
          true,
        ),
      );
    } else if (kind === 'differentServer') {
      ports.credentials.value = original.replace(
        CONFIG.serverBaseAddress,
        'https://another.example.test',
      );
    } else if (kind === 'differentClient') {
      ports.credentials.value = original.replace(
        '"clientId":"native-client"',
        '"clientId":"other-client"',
      );
    } else if (kind === 'differentEnvironment') {
      ports.credentials.value = original.replace('"environment":"test"', '"environment":"other"');
    } else if (kind === 'differentInstall') {
      ports.credentials.value = original.replace(INSTALL_DIGEST, 'other-device-digest');
    } else if (kind === 'readUnavailable') {
      ports.credentials.readResult = { kind: 'unavailable' };
    } else {
      ports.credentials.read = async () => {
        throw new Error('credential read failed');
      };
    }
    const before = ports.credentials.value;

    await persistRotatedSessionAfterDispose(runtime, client, INSTALL_DIGEST, REFRESH_OLD_TOKEN, {
      accessToken: 'access-next',
      refreshToken: REFRESH_NEXT_TOKEN,
      lineageId: LINEAGE_ID,
    });

    expect(ports.credentials.value).toBe(before);
    const revokes = transport.sent.filter(({ path }) => path === '/api/oauth/revoke');
    if (revoke) {
      expect(revokes).toContainEqual(
        expect.objectContaining({
          body: expect.objectContaining({ token: REFRESH_NEXT_TOKEN }),
        }),
      );
    } else {
      expect(revokes).toHaveLength(0);
    }
  });

  it.each([
    ['429 rate limit', new ApiError({ status: 429, code: RATE_LIMIT_EXCEEDED_CODE, message: '' })],
    ['503 authority', new ApiError({ status: 503, code: AUTHORITY_UNAVAILABLE_CODE, message: '' })],
    ['invalid grant', new OAuthError({ status: 400, error: 'invalid_grant' })],
  ] as const)('does not change a successor record after %s', async (_name, error) => {
    const { runtime, ports } = disposedRuntime();
    const stable = makeRefreshRecord(runtime, INSTALL_DIGEST, {
      ...TOKENS,
      refreshToken: REFRESH_SUCCESSOR_TOKEN,
    });
    ports.credentials.value = JSON.stringify(stable);

    await settleDisposedRefreshFailure(
      runtime,
      makeRefreshRecord(runtime, INSTALL_DIGEST, TOKENS),
      error,
    );

    expect(ports.credentials.value).toBe(JSON.stringify(stable));
    expect(ports.credentials.events.filter((event) => event === 'delete:start')).toHaveLength(0);
    expect(ports.credentials.events.filter((event) => event === 'replace:start')).toHaveLength(0);
  });

  it.each([
    [500, RATE_LIMIT_EXCEEDED_CODE],
    [429, AUTHORITY_UNAVAILABLE_CODE],
    [500, AUTHORITY_UNAVAILABLE_CODE],
    [503, 'TRANSACTION_OUTCOME_UNKNOWN'],
  ] as const)('keeps a marker for mismatched HTTP failure %i %s', async (status, code) => {
    const { runtime, ports } = disposedRuntime();
    const marker = ports.credentials.value;
    if (!marker) throw new Error('Expected a stored refresh marker');

    await settleDisposedRefreshFailure(
      runtime,
      makeRefreshRecord(runtime, INSTALL_DIGEST, TOKENS),
      new ApiError({ status, code, message: '' }),
    );

    expect(ports.credentials.value).toBe(marker);
    expect(ports.credentials.events.filter((event) => event === 'read')).toHaveLength(0);
    expect(ports.credentials.events.filter((event) => event === 'replace:start')).toHaveLength(0);
    expect(ports.credentials.events.filter((event) => event === 'delete:start')).toHaveLength(0);
  });
});
