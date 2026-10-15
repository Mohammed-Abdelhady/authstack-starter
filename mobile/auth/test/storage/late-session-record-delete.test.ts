import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_DELETE_TIMEOUT_MS,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  SIGN_OUT_REVOKE_TIMEOUT_MS,
} from '../../src/constants';
import { createAuthEngine } from '../support/engine';
import { queuedWorkDone } from '../support/queued-work';
import { revokedTokens } from '../support/tracking';
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
  it('writes the sign-out after a timed-out marker write lands, so no session survives', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);

    const markerStarted = new Deferred<void>();
    const finishMarker = new Deferred<void>();
    const markerLanded = new Deferred<void>();
    let blockMarker = true;
    ports.credentials.beforeReplace = (value) => {
      if (blockMarker && value.includes('"refreshInFlight":true')) {
        blockMarker = false;
        markerStarted.resolve();
        return finishMarker.promise;
      }
      return Promise.resolve();
    };
    ports.credentials.afterReplace = (value) => {
      if (value.includes('"refreshInFlight":true')) markerLanded.resolve();
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
    finishMarker.resolve();
    await markerLanded.promise;
    await expect(signOut).resolves.toEqual({ kind: 'signedOut', revocation: 'revoked' });
    await expect(engine.restore()).resolves.toEqual({ kind: 'restored', status: 'signedOut' });

    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
  });

  it('writes the sign-out after a late token write, keeping only the revocation', async () => {
    const scenario = await beginBlockedTokenWrite();
    const { engine, ports, transport, signIn, finishWrite, lateWriteLanded, revokeStarted } =
      scenario;
    // The interrupted sign-in revokes its late token and the saved sign-out tries the same
    // one: both wait on the one request in flight for that token.
    const intentSaved = new Deferred<void>();
    const afterTokenWrite = ports.credentials.afterReplace;
    ports.credentials.afterReplace = (value) => {
      afterTokenWrite?.(value);
      if (value.includes('"pendingRevocations"')) intentSaved.resolve();
    };
    const signOut = engine.signOut();
    finishWrite.resolve();
    await lateWriteLanded.promise;
    await Promise.all([revokeStarted.promise, intentSaved.promise]);
    // The sign-out's attempt starts from the continuations its saved write queued.
    await queuedWorkDone();
    ports.timer.fireDelay(SIGN_OUT_REVOKE_TIMEOUT_MS);
    await expect(signIn).resolves.toEqual({ kind: 'signedOut' });
    await expect(signOut).resolves.toMatchObject({ kind: 'signedOut', revocation: 'timedOut' });

    await expect(engine.restore()).resolves.toMatchObject({ status: 'signedOut' });

    expect(JSON.parse(ports.credentials.value ?? '{}')).toEqual({
      version: 1,
      pendingRevocations: [expect.objectContaining({ refreshToken: REFRESH_TOKEN, attempts: 1 })],
    });
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
  });

  it('leaves nothing that can restore or refresh when a stale token write lands after a later epoch', async () => {
    const scenario = await beginBlockedTokenWrite();
    const { engine, ports, transport, signIn, finishWrite, lateWriteLanded, revokeStarted } =
      scenario;
    const signOut = engine.signOut();
    // The sign-out write waits behind the token write and times out with it. A sign-in
    // was writing tokens, so the session ends here instead of coming back.
    await queuedWorkDone();
    expect(ports.timer.pendingDelays).toEqual([
      CREDENTIAL_WRITE_TIMEOUT_MS,
      CREDENTIAL_WRITE_TIMEOUT_MS,
    ]);
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await revokeStarted.promise;
    ports.timer.fireDelay(SIGN_OUT_REVOKE_TIMEOUT_MS);
    await expect(signIn).resolves.toEqual({ kind: 'signedOut' });
    await expect(signOut).resolves.toMatchObject({ kind: 'signedOut', revocation: 'timedOut' });
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', warning: 'storageBlocked' });
    ports.crypto.randomBytes = () => Promise.reject(new Error('entropy unavailable'));
    await expect(engine.signIn()).resolves.toMatchObject({ kind: 'cryptoFailure' });

    const restore = engine.restore();
    finishWrite.resolve();
    await lateWriteLanded.promise;
    await expect(restore).resolves.toMatchObject({ status: 'signedOut' });

    expect(ports.credentials.value).toBeUndefined();
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    const restartedTransport = new ScriptedTransport();
    const restartedPorts = testPorts(restartedTransport);
    restartedPorts.credentials.value = ports.credentials.value;
    restartedPorts.install = ports.install;
    const restarted = createAuthEngine(CONFIG, restartedPorts);
    await expect(restarted.restore()).resolves.toEqual({ kind: 'restored', status: 'signedOut' });
    await expect(restarted.refresh()).resolves.toEqual({ kind: 'notSignedIn' });
    expect(restartedTransport.sent).toEqual([]);
  });

  it('keeps a late token write deleted when disposal times out sign out', async () => {
    const scenario = await beginBlockedTokenWrite();
    const { engine, ports, transport, finishWrite, lateWriteLanded, revokeStarted } = scenario;
    const deletesFinished = gateDeletes(ports, 1);
    const correctionDeleteScheduled = new Deferred<void>();
    const correctionDeleteCancelled = new Deferred<void>();
    let deleteDeadlines = 0;
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS) {
        deleteDeadlines += 1;
        if (deleteDeadlines === 1) correctionDeleteScheduled.resolve();
      }
    };
    ports.timer.onCancel = (milliseconds) => {
      if (milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS && deleteDeadlines >= 1)
        correctionDeleteCancelled.resolve();
    };
    // The sign-out write waits behind the token write, so disposal comes before any revoke.
    const signOut = engine.signOut();
    engine.dispose();
    expect(revokedTokens(transport)).toEqual([]);
    await expect(signOut).resolves.toMatchObject({ kind: 'disposed' });
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    // The abandoned sign-out still asks the server once, since no one heard it failed.
    await revokeStarted.promise;
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
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
