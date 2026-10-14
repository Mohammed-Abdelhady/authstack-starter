import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_DELETE_TIMEOUT_MS,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  SIGN_OUT_REVOKE_TIMEOUT_MS,
} from '../../src/constants';
import { createAuthEngine } from '../support/engine';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  acceptCode,
  apiReply,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('late session record writes after sign out', () => {
  it('does not restore a stable token record when a timed-out marker write lands after sign out', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);

    const markerStarted = new Deferred<void>();
    const finishMarker = new Deferred<void>();
    const retryDeleteDeadline = new Deferred<void>();
    const deleteDeadlineScheduled = new Deferred<void>();
    const revokeStarted = new Deferred<void>();
    let deleteDeadlines = 0;
    let blockMarker = true;
    ports.credentials.beforeReplace = (value) => {
      if (blockMarker && value.includes('"refreshInFlight":true')) {
        blockMarker = false;
        markerStarted.resolve();
        return finishMarker.promise;
      }
      return Promise.resolve();
    };
    ports.credentials.beforeDelete = () => {
      return Promise.reject(new Error('secure storage unavailable'));
    };
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS) {
        deleteDeadlines += 1;
        if (deleteDeadlines === 1) deleteDeadlineScheduled.resolve();
        if (deleteDeadlines === 2) retryDeleteDeadline.resolve();
      }
    };
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/revoke') revokeStarted.resolve();
    };
    transport.enqueue({ status: 200, body: {} });

    const request = engine.transport.request({
      method: 'GET',
      path: '/api/user/profile',
    });
    await markerStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await expect(request).rejects.toMatchObject({ operation: 'credentials.replace' });

    const signOut = engine.signOut();
    await Promise.all([deleteDeadlineScheduled.promise, revokeStarted.promise]);
    ports.timer.fireDelay(CREDENTIAL_DELETE_TIMEOUT_MS);
    await expect(signOut).resolves.toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    finishMarker.resolve();
    const restore = engine.restore();
    await retryDeleteDeadline.promise;
    ports.timer.fireDelay(CREDENTIAL_DELETE_TIMEOUT_MS);
    await expect(restore).resolves.toMatchObject({ kind: 'storageBlocked' });

    expect(ports.credentials.value).toContain('"refreshInFlight":true');
    expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_TOKEN}"`);
  });

  it('deletes a late token write after a later epoch', async () => {
    const scenario = await beginBlockedTokenWrite();
    const { engine, ports, transport, signIn, finishWrite, lateWriteLanded, revokeStarted } =
      scenario;
    const deletesFinished = gateDeletes(ports);
    const signOut = engine.signOut();
    await revokeStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_DELETE_TIMEOUT_MS);
    ports.timer.fireDelay(SIGN_OUT_REVOKE_TIMEOUT_MS);
    await expect(signIn).resolves.toEqual({ kind: 'signedOut' });
    await expect(signOut).resolves.toMatchObject({ kind: 'signedOut', revocation: 'timedOut' });
    ports.crypto.randomBytes = () => Promise.reject(new Error('entropy unavailable'));
    await expect(engine.signIn()).resolves.toMatchObject({ kind: 'cryptoFailure' });

    const restore = engine.restore();
    finishWrite.resolve();
    await lateWriteLanded.promise;
    await deletesFinished.started.promise;
    deletesFinished.release.resolve();
    await deletesFinished.finished.promise;
    await expect(restore).resolves.toMatchObject({ status: 'signedOut' });

    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/revoke')).toHaveLength(1);
  });

  it('keeps a late token write deleted when disposal times out sign out', async () => {
    const scenario = await beginBlockedTokenWrite();
    const { engine, ports, finishWrite, lateWriteLanded, revokeStarted } = scenario;
    const deletesFinished = gateDeletes(ports, 1);
    const correctionDeleteScheduled = new Deferred<void>();
    const correctionDeleteCancelled = new Deferred<void>();
    let deleteDeadlines = 0;
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS) {
        deleteDeadlines += 1;
        if (deleteDeadlines === 2) correctionDeleteScheduled.resolve();
      }
    };
    ports.timer.onCancel = (milliseconds) => {
      if (milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS && deleteDeadlines >= 2)
        correctionDeleteCancelled.resolve();
    };
    const signOut = engine.signOut();
    await revokeStarted.promise;
    engine.dispose();
    await expect(signOut).resolves.toMatchObject({ kind: 'disposed' });
    ports.timer.fireDelay(CREDENTIAL_DELETE_TIMEOUT_MS);
    ports.timer.fireDelay(SIGN_OUT_REVOKE_TIMEOUT_MS);

    finishWrite.resolve();
    await lateWriteLanded.promise;
    await deletesFinished.started.promise;
    await correctionDeleteScheduled.promise;
    deletesFinished.release.resolve();
    await deletesFinished.finished.promise;
    await correctionDeleteCancelled.promise;
    const nextPorts = testPorts(new ScriptedTransport());
    nextPorts.credentials = ports.credentials;
    nextPorts.install = ports.install;
    const restarted = createAuthEngine(CONFIG, nextPorts);

    await expect(restarted.restore()).resolves.toMatchObject({ status: 'signedOut' });
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pendingDelays).toEqual([]);
  });
});

async function beginBlockedTokenWrite() {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const engine = createAuthEngine(CONFIG, ports);
  await engine.restore();
  const writeStarted = new Deferred<void>();
  const finishWrite = new Deferred<void>();
  const lateWriteLanded = new Deferred<void>();
  const revokeStarted = new Deferred<void>();
  ports.credentials.beforeReplace = (value) => {
    if (!value.includes('"tokens"')) return Promise.resolve();
    writeStarted.resolve();
    return finishWrite.promise;
  };
  ports.credentials.afterReplace = (value) => {
    if (value.includes('"tokens"')) lateWriteLanded.resolve();
  };
  transport.enqueue(oauthTokenReply(), apiReply({}));
  transport.onRequest = ({ path }) => {
    if (path === '/api/oauth/revoke') revokeStarted.resolve();
  };
  transport.respond = (request) => {
    if (request.path === '/api/oauth/token') return Promise.resolve(oauthTokenReply());
    if (request.path === '/api/oauth/revoke') {
      revokeStarted.resolve();
      return new Promise(() => undefined);
    }
    return Promise.reject(new Error(`Unexpected request: ${request.path}`));
  };
  acceptCode(ports.authBrowser);
  const signIn = engine.signIn();
  await writeStarted.promise;
  return { engine, ports, transport, signIn, finishWrite, lateWriteLanded, revokeStarted };
}

function gateDeletes(ports: ReturnType<typeof testPorts>, expectedCount = 2) {
  const started = new Deferred<void>();
  const release = new Deferred<void>();
  const finished = new Deferred<void>();
  let count = 0;
  ports.credentials.beforeDelete = () => {
    started.resolve();
    return release.promise;
  };
  ports.credentials.afterDelete = () => {
    count += 1;
    if (count === expectedCount) finished.resolve();
  };
  return { started, release, finished };
}
