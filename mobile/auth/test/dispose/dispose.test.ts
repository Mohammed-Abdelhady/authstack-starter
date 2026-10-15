import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { CREDENTIAL_WRITE_TIMEOUT_MS } from '../../src/constants';
import { createAuthEngine } from '../support/engine';
import { watchTimerDrain } from '../support/timer-drain';
import { revokedTokens } from '../support/tracking';
import {
  Deferred,
  CONFIG,
  REFRESH_TOKEN,
  ScriptedTransport,
  apiReply,
  establishSession,
  testPorts,
} from '../support/support';

describe('engine disposal', () => {
  it('settles sign-in, cancels deadlines, removes subscriptions, and refuses transport', async () => {
    const ports = testPorts(new ScriptedTransport());
    const browserOpened = new Deferred<void>();
    const deleteFinished = new Deferred<void>();
    const deleteTimerCancelled = new Deferred<void>();
    let deletionCompleted = false;
    ports.authBrowser.beforeOpen = () => browserOpened.resolve();
    ports.authBrowser.results.push(() => new Promise(() => undefined));
    ports.credentials.afterDelete = () => {
      deletionCompleted = true;
      deleteFinished.resolve();
    };
    ports.timer.onCancel = (milliseconds) => {
      if (deletionCompleted && milliseconds === 4000) deleteTimerCancelled.resolve();
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const pending = engine.signIn();
    await browserOpened.promise;

    engine.dispose();

    await expect(pending).resolves.toEqual({ kind: 'disposed' });
    await deleteFinished.promise;
    await deleteTimerCancelled.promise;
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    expect(ports.timer.pendingDelays).toEqual([]);
    expect(ports.callbacks.listeners.size).toBe(0);
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toMatchObject({ name: 'AuthDisposedError' });
  });

  it('settles a pending restore as disposed', async () => {
    const ports = testPorts(new ScriptedTransport());
    const identity = new Deferred<{ kind: 'found'; id: string }>();
    const identityStarted = new Deferred<void>();
    ports.install.identity = () => {
      identityStarted.resolve();
      return identity.promise;
    };
    const engine = createAuthEngine(CONFIG, ports);
    const restore = engine.restore();
    await identityStarted.promise;

    engine.dispose();

    await expect(restore).resolves.toEqual({ kind: 'disposed' });
    expect(ports.timer.pending).toBe(0);
    identity.resolve({ kind: 'found', id: 'install-1' });
  });

  it('deletes the saved verifier when disposed during authorization', async () => {
    const ports = testPorts(new ScriptedTransport());
    const opened = new Deferred<void>();
    const deleted = new Deferred<void>();
    ports.authBrowser.beforeOpen = () => opened.resolve();
    ports.authBrowser.results.push(() => new Promise(() => undefined));
    ports.credentials.afterDelete = () => deleted.resolve();
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const signIn = engine.signIn();
    await opened.promise;
    expect(ports.credentials.value).toContain('"verifier"');

    engine.dispose();

    await expect(signIn).resolves.toEqual({ kind: 'disposed' });
    await deleted.promise;
    expect(ports.credentials.value).toBeUndefined();
  });

  it('settles a pending sign-out as disposed and cancels its deadlines', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    // The sign-out's one write is a replace that stores the intent; its deadline is the write's.
    const writeStarted = new Deferred<void>();
    const finishWrite = new Deferred<void>();
    const writeDeadlineCancelled = new Deferred<void>();
    const slotCleared = new Deferred<void>();
    let writeCompleted = false;
    ports.credentials.beforeReplace = () => {
      writeStarted.resolve();
      return finishWrite.promise;
    };
    ports.credentials.afterReplace = () => {
      writeCompleted = true;
    };
    ports.credentials.afterDelete = () => slotCleared.resolve();
    const timersDrained = watchTimerDrain(ports.timer, {
      onCancel: (milliseconds) => {
        if (writeCompleted && milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS)
          writeDeadlineCancelled.resolve();
      },
    });
    transport.enqueue({ status: 200, body: {} });
    const signOut = engine.signOut();
    await writeStarted.promise;

    engine.dispose();

    await expect(signOut).resolves.toEqual({ kind: 'disposed' });
    expect(ports.timer.pendingDelays).toContain(CREDENTIAL_WRITE_TIMEOUT_MS);
    finishWrite.resolve();
    await writeDeadlineCancelled.promise;
    await slotCleared.promise;
    await timersDrained();
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
  });

  it('settles an in-flight API call as disposed', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const answer = new Deferred<ReturnType<typeof apiReply>>();
    const requestStarted = new Deferred<void>();
    const responseReceived = new Deferred<void>();
    transport.onRequest = ({ path }) => {
      if (path === '/api/user/profile') requestStarted.resolve();
    };
    transport.onResponse = ({ path }) => {
      if (path === '/api/user/profile') responseReceived.resolve();
    };
    transport.enqueue(() => answer.promise);
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await requestStarted.promise;

    engine.dispose();

    await expect(request).rejects.toMatchObject({ name: 'AuthDisposedError' });
    answer.resolve(apiReply({ id: 'late' }));
    await responseReceived.promise;
  });

  it('does not publish signed out while disposing a persisted session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const states: string[] = [];
    engine.subscribe((snapshot) => states.push(`${snapshot.status}/${snapshot.operation}`));

    engine.dispose();

    expect(states).toEqual(['signedIn/none']);
    expect(ports.credentials.value).toContain('"refreshToken"');
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });
});
