import {
  REFRESH_DISPOSE_INSTALL_TOKEN,
  REFRESH_ROTATED_TOKEN,
  REFRESH_AFTER_TIMEOUT_TOKEN,
  REFRESH_BEFORE_TIMEOUT_TOKEN,
  REFRESH_DISPOSE_LINEAGE_TOKEN,
  REFRESH_SENT_TOKEN,
} from '../../support/token-values';
import { createApiClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { AuthDisposedError, AuthSessionError } from '../../../src/errors/errors';
import { CREDENTIAL_WRITE_TIMEOUT_MS } from '../../../src/constants';
import { createRefreshCoordinator } from '../../../src/refresh/refresh';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { settleDisposedToken } from '../../../src/refresh/refresh-dispose';
import { AuthRuntime } from '../../../src/runtime/runtime';
import { persistRotatedSessionAfterDispose } from '../../../src/refresh/refresh-dispose';
import type { RuntimeTokens } from '../../../src/types/record';
import { createAuthEngine } from '../../support/engine';
import { revokedTokens } from '../../support/tracking';
import { watchTimerDrain } from '../../support/timer-drain';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  establishSession,
  oauthTokenReply,
  successUserReply,
  testPorts,
} from '../../support/support';

const INSTALL_DIGEST = REFRESH_DISPOSE_INSTALL_TOKEN;

describe('rotated credentials during sign-out and disposal', () => {
  it('removes and revokes the rotated token after sign-out interrupts its write', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const timersDrained = watchTimerDrain(ports.timer);
    ports.clock.advance(270_000);

    const rotatedWriteStarted = new Deferred<void>();
    const releaseWrite = new Deferred<void>();
    const rotatedRevocation = new Deferred<void>();
    const revoked: string[] = [];
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes(REFRESH_ROTATED_TOKEN)) return;
      rotatedWriteStarted.resolve();
      await releaseWrite.promise;
    };
    transport.respond = async (request) => {
      if (request.path === '/api/oauth/token')
        return oauthTokenReply('access-rotated', REFRESH_ROTATED_TOKEN);
      if (request.path === '/api/user/profile') return successUserReply();
      if (request.path === '/api/oauth/revoke') {
        const token = requestToken(request.body);
        revoked.push(token);
        return { status: 200, body: {} };
      }
      throw new Error(`Unexpected request: ${request.path}`);
    };
    transport.onResponse = (request) => {
      if (
        request.path === '/api/oauth/revoke' &&
        requestToken(request.body) === REFRESH_ROTATED_TOKEN
      )
        rotatedRevocation.resolve();
    };
    const request = engine.transport.request({ method: 'GET', path: '/api/user/profile' });
    await rotatedWriteStarted.promise;
    const signOut = engine.signOut();
    engine.dispose();
    releaseWrite.resolve();

    await expect(request).rejects.toBeInstanceOf(AuthDisposedError);
    await Promise.all([signOut, rotatedRevocation.promise]);
    await timersDrained();

    expect(revoked).toEqual([REFRESH_TOKEN, REFRESH_ROTATED_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
  });

  it('keeps a late stored rotation without revoking its exact saved token', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/token')
        return oauthTokenReply('access-after-timeout', REFRESH_AFTER_TIMEOUT_TOKEN);
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const oldTokens: RuntimeTokens = {
      accessToken: 'access-before-timeout',
      refreshToken: REFRESH_BEFORE_TIMEOUT_TOKEN,
      expiresAt: 0,
      version: 1,
      lineageId: REFRESH_DISPOSE_LINEAGE_TOKEN,
    };
    runtime.installDigest = INSTALL_DIGEST;
    runtime.tokens = oldTokens;
    runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, oldTokens);
    ports.credentials.value = JSON.stringify(runtime.record);
    runtime.setState('signedIn', 'none');

    const writeStarted = new Deferred<void>();
    const releaseWrite = new Deferred<void>();
    const timersDrained = watchTimerDrain(ports.timer);
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes(REFRESH_AFTER_TIMEOUT_TOKEN)) return;
      writeStarted.resolve();
      await releaseWrite.promise;
    };
    const client = createApiClient(runtime.rawTransport);
    const coordinator = createRefreshCoordinator(runtime, client, client);
    const refresh = coordinator.refresh();
    await writeStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    runtime.dispose();
    releaseWrite.resolve();

    await expect(refresh).rejects.toBeInstanceOf(AuthSessionError);
    await runtime.writeTail;
    await timersDrained();

    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.credentials.value).toContain(REFRESH_AFTER_TIMEOUT_TOKEN);
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
    expect(ports.timer.pending).toBe(0);
  });

  it('revokes a late rotation when the marker still holds the token sent', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const lineageId = 'disposed-rotation-lineage';
    const previous: RuntimeTokens = {
      accessToken: 'access-before-timeout',
      refreshToken: REFRESH_BEFORE_TIMEOUT_TOKEN,
      expiresAt: 0,
      version: 1,
      lineageId,
    };
    runtime.installDigest = INSTALL_DIGEST;
    runtime.tokens = previous;
    runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, previous, true);
    ports.credentials.value = JSON.stringify(runtime.record);
    runtime.setState('signedIn', 'refreshing');

    const writeStarted = new Deferred<void>();
    const releaseWrite = new Deferred<void>();
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes(REFRESH_AFTER_TIMEOUT_TOKEN)) return;
      writeStarted.resolve();
      await releaseWrite.promise;
    };
    const rotated = {
      ...makeRefreshRecord(runtime, INSTALL_DIGEST, {
        accessToken: 'access-after-timeout',
        refreshToken: REFRESH_AFTER_TIMEOUT_TOKEN,
        lineageId,
      }),
    };
    const write = runtime
      .replaceRecord(
        rotated,
        runtime.epoch,
        { kind: 'replace', record: rotated },
        {
          kind: 'session',
          installDigest: INSTALL_DIGEST,
          refreshToken: REFRESH_AFTER_TIMEOUT_TOKEN,
          lineageId,
        },
      )
      .catch(() => false);
    await writeStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await write;
    runtime.dispose();

    await settleDisposedToken(
      runtime,
      createApiClient(runtime.rawTransport),
      INSTALL_DIGEST,
      lineageId,
      REFRESH_AFTER_TIMEOUT_TOKEN,
      REFRESH_BEFORE_TIMEOUT_TOKEN,
    );
    releaseWrite.resolve();
    await runtime.writeTail;

    expect(revokedTokens(transport)).toEqual([REFRESH_AFTER_TIMEOUT_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
  });

  it('does not revoke a rotation when a successor has a different stable session', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const successorTokens: RuntimeTokens = {
      accessToken: 'successor-access',
      refreshToken: 'successor-refresh',
      expiresAt: 0,
      version: 3,
      lineageId: REFRESH_DISPOSE_LINEAGE_TOKEN,
    };
    runtime.installDigest = INSTALL_DIGEST;
    runtime.tokens = successorTokens;
    runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, successorTokens);
    ports.credentials.value = JSON.stringify(runtime.record);
    runtime.setState('signedIn', 'none');
    runtime.dispose();
    const successorRecord = ports.credentials.value;
    const client = createApiClient(runtime.rawTransport);

    await persistRotatedSessionAfterDispose(runtime, client, INSTALL_DIGEST, REFRESH_SENT_TOKEN, {
      accessToken: 'late-access',
      refreshToken: 'late-refresh',
      lineageId: REFRESH_DISPOSE_LINEAGE_TOKEN,
    });

    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.credentials.value).toBe(successorRecord);
    expect(ports.timer.pending).toBe(0);
  });

  it('revokes a timed-out rotation when its original marker holds the sent token', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const lineageId = 'late-rotation-lineage';
    const previous: RuntimeTokens = {
      accessToken: 'access-before-timeout',
      refreshToken: REFRESH_BEFORE_TIMEOUT_TOKEN,
      expiresAt: 0,
      version: 1,
      lineageId,
    };
    runtime.installDigest = INSTALL_DIGEST;
    runtime.tokens = previous;
    runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, previous, true);
    ports.credentials.value = JSON.stringify(runtime.record);
    runtime.setState('signedIn', 'refreshing');
    runtime.dispose();

    const writeStarted = new Deferred<void>();
    const releaseWrite = new Deferred<void>();
    const timersDrained = watchTimerDrain(ports.timer);
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes(REFRESH_ROTATED_TOKEN)) return;
      writeStarted.resolve();
      await releaseWrite.promise;
    };
    const persist = persistRotatedSessionAfterDispose(
      runtime,
      createApiClient(runtime.rawTransport),
      INSTALL_DIGEST,
      REFRESH_BEFORE_TIMEOUT_TOKEN,
      { accessToken: 'access-rotated', refreshToken: REFRESH_ROTATED_TOKEN, lineageId },
    );
    await writeStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await persist;
    releaseWrite.resolve();
    await runtime.writeTail;
    await timersDrained();

    expect(revokedTokens(transport)).toEqual([REFRESH_ROTATED_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
  });
});

function requestToken(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'token' in body &&
    typeof body.token === 'string'
  )
    return body.token;
  throw new Error('Expected a token revocation request');
}
