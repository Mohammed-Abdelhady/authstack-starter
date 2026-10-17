import { createFetchTransport, createNativePorts } from '@app/native-adapters';
import {
  FAKE_SHA256,
  FakeCrypto,
  FakeLinking,
  FakeMarkerFile,
  FakeSecureStore,
  FakeServer,
  FakeTime,
  FakeUuid,
  FakeWebBrowser,
} from '@app/native-adapters/testing';
import { createAuthEngine } from '@app/native-auth';
import { describe, expect, it } from 'vitest';

import { createDebugTransport, type DebugTransport } from '../src/logic/debug-transport';

import { resolveConfig } from '../src/logic/resolve-config';
import { storageWarningAfter } from '../src/logic/storage-warning';

const DEADLINE_MS = 20_000;
const IO_ERROR = 'I/O error.';

/** A signed-in engine over the adapters, with the store and the server a test can break. */
async function signedIn() {
  const store = new FakeSecureStore();
  const server = new FakeServer();
  const browser = new FakeWebBrowser();
  browser.respond = (url) => ({ type: 'success', url: server.authorize(url) });
  const time = new FakeTime();
  const configuration = resolveConfig({
    apiOrigin: undefined,
    development: true,
    scheme: 'com.example.mobile',
  });
  const ports = createNativePorts(
    {
      secureStore: store,
      keychainOptions: { keychainAccessible: 4 },
      webBrowser: browser,
      crypto: new FakeCrypto(),
      sha256Algorithm: FAKE_SHA256,
      linking: new FakeLinking(null),
      installMarker: new FakeMarkerFile(),
      recordMarker: new FakeMarkerFile(),
      uuid: new FakeUuid(),
      clock: time,
      timers: time,
    },
    {
      clientId: configuration.clientId,
      environment: configuration.environment,
      ephemeralBrowserSession: true,
    },
  );
  const debugs: DebugTransport[] = [];
  const engine = createAuthEngine(configuration, {
    ...ports,
    makeTransport(baseAddress) {
      const debug = createDebugTransport(
        createFetchTransport(server, ports.timer, baseAddress, DEADLINE_MS),
      );
      debugs.push(debug);
      return debug.transport;
    },
  });
  await engine.restore();
  await engine.signIn();
  const refreshesSent = (): number => debugs[0]?.refreshTokenRequests() ?? 0;
  return { engine, store, server, refreshesSent };
}

describe('which storage warning the screen shows, from what the engine did', () => {
  it('says the session is in memory only after a refresh whose save was refused', async () => {
    const { engine, store, server, refreshesSent } = await signedIn();
    const send = server.fetch.bind(server);
    server.fetch = (address, init) => {
      if (address.endsWith('/api/oauth/token')) store.writeFailure = IO_ERROR;
      return send(address, init);
    };
    const sentBefore = refreshesSent();

    const outcome = await engine.refresh();

    expect(outcome).toEqual({ kind: 'refreshed' });
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', warning: 'storageBlocked' });
    expect(storageWarningAfter(undefined, engine.snapshot, refreshesSent() > sentBefore)).toBe(
      'sessionInMemory',
    );
  });

  it('says no refresh was sent when the write before it is refused', async () => {
    const { engine, store, server, refreshesSent } = await signedIn();
    store.failNextSet = true;
    const sentBefore = refreshesSent();

    const outcome = await engine.refresh();

    expect(outcome.kind).toBe('failed');
    expect(server.refreshes).toBe(0);
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', warning: 'storageBlocked' });
    expect(storageWarningAfter(undefined, engine.snapshot, refreshesSent() > sentBefore)).toBe(
      'refreshNotSent',
    );
  });

  it('says the saved record could not be deleted after a sign-out whose delete failed', async () => {
    const { engine, store, refreshesSent } = await signedIn();
    await engine.signOut();
    // With no session left, a sign-out only removes the record, and that delete is refused.
    store.writeFailure = IO_ERROR;
    const sentBefore = refreshesSent();

    const outcome = await engine.signOut();

    expect(outcome).toMatchObject({ kind: 'signedOut', revocation: 'notNeeded' });
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', warning: 'storageBlocked' });
    expect(storageWarningAfter(undefined, engine.snapshot, refreshesSent() > sentBefore)).toBe(
      'deleteFailed',
    );
  });

  it('keeps the person signed in and says storage failed when a sign-out cannot be saved', async () => {
    const { engine, store, server, refreshesSent } = await signedIn();
    store.writeFailure = IO_ERROR;
    const sentBefore = refreshesSent();

    const outcome = await engine.signOut();

    // Nothing was written, so no warning says the person left or a delete failed.
    expect(outcome.kind).toBe('signOutNotSaved');
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    expect(engine.snapshot.warning).toBeUndefined();
    expect(storageWarningAfter(undefined, engine.snapshot, refreshesSent() > sentBefore)).toBe(
      undefined,
    );
    expect(server.revoked).toEqual([]);
  });
});
