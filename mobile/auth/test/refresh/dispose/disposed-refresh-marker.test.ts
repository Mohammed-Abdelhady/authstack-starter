import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { CREDENTIAL_WRITE_TIMEOUT_MS, OAUTH_REFRESH_TIMEOUT_MS } from '../../../src/constants';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../../src/runtime/runtime';
import type { RuntimeTokens } from '../../../src/types/record';
import { createAuthEngine } from '../../support/engine';
import { OLD_ACCESS_2_TOKEN, OLD_REFRESH_2_TOKEN } from '../../support/token-values';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  establishSession,
  testPorts,
  oauthTokenReply,
} from '../../support/support';

describe('dispose before a refresh request is sent', () => {
  it('restores the stable record instead of leaving an unsent marker', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const writesBeforeRefresh = ports.credentials.events.filter(
      (event) => event === 'replace:done',
    ).length;
    const stableWriteFinished = new Deferred<void>();
    let stableWriteStarted = false;
    const stableWriteTimerCancelled = new Deferred<void>();
    ports.credentials.afterReplace = (value) => {
      if (value.includes(REFRESH_TOKEN) && !value.includes('refreshInFlight')) {
        stableWriteStarted = true;
        stableWriteFinished.resolve();
      }
    };
    ports.timer.onCancel = (milliseconds) => {
      if (stableWriteStarted && milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS)
        stableWriteTimerCancelled.resolve();
    };
    ports.clock.advance(270_000);
    const after = ports.timer.after.bind(ports.timer);
    ports.timer.after = (milliseconds, callback) => {
      if (milliseconds === OAUTH_REFRESH_TIMEOUT_MS) engine.dispose();
      return after(milliseconds, callback);
    };

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toMatchObject({ name: 'AuthDisposedError' });
    await stableWriteFinished.promise;
    await stableWriteTimerCancelled.promise;

    expect(ports.credentials.events.filter((event) => event === 'replace:done')).toHaveLength(
      writesBeforeRefresh + 2,
    );
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    expect(ports.credentials.value).toContain(REFRESH_TOKEN);
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
    expect(ports.timer.pendingDelays).toEqual([]);
  });

  it('does not turn a disposed late marker into a reusable refresh record', async () => {
    const oldTransport = new ScriptedTransport();
    const oldPorts = testPorts(oldTransport);
    const oldEngine = createAuthEngine(CONFIG, oldPorts);
    await establishSession(oldEngine, oldPorts, oldTransport);
    oldPorts.clock.advance(270_000);

    const markerWriteStarted = new Deferred<void>();
    const releaseMarkerWrite = new Deferred<void>();
    let holdFirstMarker = true;
    oldPorts.credentials.beforeReplace = (value) => {
      if (holdFirstMarker && value.includes('"refreshInFlight":true')) {
        holdFirstMarker = false;
        markerWriteStarted.resolve();
        return releaseMarkerWrite.promise;
      }
      return Promise.resolve();
    };
    oldTransport.enqueue(oauthTokenReply(OLD_ACCESS_2_TOKEN, OLD_REFRESH_2_TOKEN), apiReply({}));
    const oldRequest = oldEngine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await markerWriteStarted.promise;
    oldEngine.dispose();
    await expect(oldRequest).rejects.toMatchObject({ name: 'AuthDisposedError' });

    const successorTransport = new ScriptedTransport();
    const successorPorts = testPorts(successorTransport);
    successorPorts.credentials = oldPorts.credentials;
    successorPorts.install = oldPorts.install;
    const successor = createAuthEngine(CONFIG, successorPorts);
    await successor.restore();
    successorTransport.enqueue(oauthTokenReply('next-access', 'next-refresh'), apiReply({}));
    await successor.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    expect(oldPorts.credentials.value).toContain('next-refresh');

    const lateMarkerLanded = new Deferred<void>();
    oldPorts.credentials.afterReplace = (value) => {
      if (value.includes('"refreshInFlight":true') && value.includes(REFRESH_TOKEN))
        lateMarkerLanded.resolve();
    };
    releaseMarkerWrite.resolve();
    await lateMarkerLanded.promise;

    const nextPorts = testPorts(new ScriptedTransport());
    nextPorts.credentials = oldPorts.credentials;
    nextPorts.install = oldPorts.install;
    const nextEngine = createAuthEngine(CONFIG, nextPorts);
    await expect(nextEngine.restore()).resolves.toMatchObject({
      kind: 'restored',
      status: 'reauthRequired',
    });
    expect(oldPorts.credentials.value).toContain('"refreshInFlight":true');
    successor.dispose();
    nextEngine.dispose();
  });

  it('leaves a marker when both ownership reads fail', async () => {
    const ports = testPorts(new ScriptedTransport());
    const runtime = new AuthRuntime(CONFIG, ports);
    const tokens: RuntimeTokens = {
      accessToken: 'marker-access',
      refreshToken: 'marker-refresh',
      expiresAt: 0,
      version: 1,
      lineageId: 'marker-lineage',
    };
    runtime.installDigest = 'marker-install';
    runtime.tokens = tokens;
    runtime.record = makeRefreshRecord(runtime, 'marker-install', tokens);
    ports.credentials.value = JSON.stringify(runtime.record);
    runtime.setState('signedIn', 'none');
    const marker = makeRefreshRecord(runtime, 'marker-install', tokens, true);
    const markerStarted = new Deferred<void>();
    const releaseMarker = new Deferred<void>();
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes('"refreshInFlight":true')) return;
      markerStarted.resolve();
      await releaseMarker.promise;
    };

    const write = runtime.replaceRecord(marker, runtime.epoch).catch(() => false);
    await markerStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await expect(write).resolves.toBe(false);
    runtime.dispose();

    const read = ports.credentials.read.bind(ports.credentials);
    let readCalls = 0;
    ports.credentials.read = async () => {
      readCalls += 1;
      if (runtime.disposed && readCalls <= 2) {
        throw new Error('temporary keychain read failure');
      }
      return read();
    };
    releaseMarker.resolve();
    await runtime.writeTail;

    expect(ports.credentials.value).toContain('"refreshInFlight":true');
    expect(ports.credentials.value).toContain('marker-refresh');
    expect(ports.credentials.events.filter((event) => event.startsWith('delete'))).toEqual([]);
    expect(readCalls).toBe(2);
    expect(ports.timer.pending).toBe(0);
  });

  it('removes a marker with a claimed revoke after a later ownership read succeeds', async () => {
    const ports = testPorts(new ScriptedTransport());
    const runtime = new AuthRuntime(CONFIG, ports);
    const tokens: RuntimeTokens = {
      accessToken: 'marker-access',
      refreshToken: 'marker-refresh',
      expiresAt: 0,
      version: 1,
      lineageId: 'marker-lineage',
    };
    runtime.installDigest = 'marker-install';
    runtime.tokens = tokens;
    runtime.record = makeRefreshRecord(runtime, 'marker-install', tokens);
    ports.credentials.value = JSON.stringify(runtime.record);
    runtime.setState('signedIn', 'none');
    const marker = makeRefreshRecord(runtime, 'marker-install', tokens, true);
    const markerStarted = new Deferred<void>();
    const releaseMarker = new Deferred<void>();
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes('"refreshInFlight":true')) return;
      markerStarted.resolve();
      await releaseMarker.promise;
    };

    const write = runtime.replaceRecord(marker, runtime.epoch).catch(() => false);
    await markerStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await expect(write).resolves.toBe(false);
    runtime.dispose();
    runtime.markDisposedRevocationIntent('marker-refresh');

    const read = ports.credentials.read.bind(ports.credentials);
    let readCalls = 0;
    ports.credentials.read = async () => {
      readCalls += 1;
      if (readCalls <= 2) throw new Error('temporary keychain read failure');
      return read();
    };
    releaseMarker.resolve();
    await runtime.writeTail;

    expect(readCalls).toBe(3);
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.credentials.events.filter((event) => event === 'delete:done')).toHaveLength(1);
    expect(ports.timer.pending).toBe(0);
  });
});
