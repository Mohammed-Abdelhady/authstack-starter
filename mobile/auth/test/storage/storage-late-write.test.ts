import { HTTP_METHOD } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_WRITE_TIMEOUT_MS } from '../../src/constants';
import { PortDeadlineError } from '../../src/runtime/deadlines';
import { createAuthEngine } from '../support/engine';
import {
  REFRESH_TOKEN,
  Deferred,
  CONFIG,
  ScriptedTransport,
  apiReply,
  establishSession,
  testPorts,
} from '../support/support';

describe('late credential writes', () => {
  it('corrects a write queued after its storage deadline could not be scheduled', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const replaceStarted = new Deferred<void>();
    const finishReplace = new Deferred<void>();
    const deleteFinished = new Deferred<void>();
    ports.credentials.beforeReplace = (value) => {
      if (!value.includes('"transaction"')) return Promise.resolve();
      replaceStarted.resolve();
      return finishReplace.promise;
    };
    ports.credentials.afterDelete = () => deleteFinished.resolve();
    const schedule = ports.timer.after.bind(ports.timer);
    let fiveSecondSchedules = 0;
    ports.timer.after = (milliseconds, callback) => {
      if (milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS) {
        fiveSecondSchedules += 1;
        if (fiveSecondSchedules === 5) throw new Error('storage timer unavailable');
      }
      return schedule(milliseconds, callback);
    };

    const outcome = await engine.signIn();
    await replaceStarted.promise;
    finishReplace.resolve();
    await deleteFinished.promise;

    expect(outcome.kind).toBe('storageFailure');
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.authBrowser.opened).toHaveLength(0);
    expect(engine.snapshot).toMatchObject({ status: 'storageBlocked', operation: 'none' });
  });

  it('corrects a refresh marker that lands after its write deadline', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const markerStarted = new Deferred<void>();
    const finishMarker = new Deferred<void>();
    const lateMarkerSaved = new Deferred<void>();
    const correctionSaved = new Deferred<void>();
    let markerWrite = true;
    let markerLanded = false;
    ports.credentials.beforeReplace = (value) => {
      if (!markerWrite || !value.includes('"refreshInFlight":true')) return Promise.resolve();
      markerWrite = false;
      markerStarted.resolve();
      return finishMarker.promise;
    };
    ports.credentials.afterReplace = (value) => {
      if (value.includes('"refreshInFlight":true')) {
        markerLanded = true;
        lateMarkerSaved.resolve();
      } else if (markerLanded) {
        correctionSaved.resolve();
      }
    };
    ports.clock.advance(270_000);
    transport.enqueue(apiReply({ id: 'unused' }));
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });

    await markerStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await expect(request).rejects.toBeInstanceOf(PortDeadlineError);
    finishMarker.resolve();
    await lateMarkerSaved.promise;
    await correctionSaved.promise;

    expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_TOKEN}"`);
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
  });

  it('keeps sign-out deletion after an in-flight late-write correction', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const markerStarted = new Deferred<void>();
    const finishMarker = new Deferred<void>();
    const correctionStarted = new Deferred<void>();
    const finishCorrection = new Deferred<void>();
    let markerWrite = true;
    ports.credentials.beforeReplace = (value) => {
      if (markerWrite && value.includes('"refreshInFlight":true')) {
        markerWrite = false;
        markerStarted.resolve();
        return finishMarker.promise;
      }
      if (!value.includes('"refreshInFlight":true')) {
        correctionStarted.resolve();
        return finishCorrection.promise;
      }
      return Promise.resolve();
    };
    ports.clock.advance(270_000);
    transport.enqueue({ status: 200, body: {} });
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await markerStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await expect(request).rejects.toBeInstanceOf(PortDeadlineError);
    finishMarker.resolve();
    await correctionStarted.promise;

    const signOut = engine.signOut();
    finishCorrection.resolve();
    await expect(signOut).resolves.toMatchObject({ kind: 'signedOut' });

    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
  });
});
