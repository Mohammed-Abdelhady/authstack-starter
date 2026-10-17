import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  establishSession,
  testPorts,
} from '../support/support';

async function storedSession() {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const engine = createAuthEngine(CONFIG, ports);
  await establishSession(engine, ports, transport);
  return { ports, transport };
}

describe('restore', () => {
  it('starts signed out when storage has no record', async () => {
    const engine = createAuthEngine(CONFIG, testPorts(new ScriptedTransport()));

    await engine.restore();

    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });

  it('blocks on locked storage and can restore after unlock', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials.readResult = { kind: 'locked' };
    const engine = createAuthEngine(CONFIG, ports);

    await engine.restore();
    expect(engine.snapshot.status).toBe('storageBlocked');
    ports.credentials.readResult = { kind: 'missing' };
    await engine.restore();

    expect(engine.snapshot.status).toBe('signedOut');
  });

  it('keeps a cancelled storage prompt distinct from a missing record', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.credentials.readResult = { kind: 'cancelled' };
    const engine = createAuthEngine(CONFIG, ports);

    const result = await engine.restore();

    expect(result).toEqual({ kind: 'storageBlocked', reason: 'cancelled' });
    expect(engine.snapshot.status).toBe('storageBlocked');
    expect(ports.credentials.events).not.toContain('delete:start');
  });

  it('does not delete a record when install identity is unavailable', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.credentials.value = 'saved-record';
    ports.install.result = { kind: 'unavailable' };
    const engine = createAuthEngine(CONFIG, ports);

    await engine.restore();

    expect(engine.snapshot.status).toBe('storageBlocked');
    expect(ports.credentials.value).toBe('saved-record');
  });

  it('deletes corrupt storage and returns signed out', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.credentials.readResult = { kind: 'corrupt' };
    const engine = createAuthEngine(CONFIG, ports);

    await engine.restore();

    expect(engine.snapshot.status).toBe('signedOut');
    expect(ports.credentials.events).toContain('delete:done');
  });

  it('deletes a record from a different schema version', async () => {
    const { ports } = await storedSession();
    ports.credentials.value = ports.credentials.value?.replace(
      '"schemaVersion":1',
      '"schemaVersion":99',
    );
    const engine = createAuthEngine(CONFIG, ports);

    await engine.restore();

    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot.status).toBe('signedOut');
  });

  it('does not treat unavailable storage as a missing account', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.credentials.readResult = { kind: 'unavailable' };
    const engine = createAuthEngine(CONFIG, ports);

    await engine.restore();

    expect(engine.snapshot.status).toBe('storageBlocked');
    expect(ports.credentials.events).not.toContain('delete:start');
  });

  it.each([
    ['server', { ...CONFIG, serverBaseAddress: 'https://other.example.test' }],
    ['environment', { ...CONFIG, environment: 'production' }],
  ])('deletes a record scoped to another %s', async (_name, config) => {
    const { ports } = await storedSession();
    const engine = createAuthEngine(config, ports);

    await engine.restore();

    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot.status).toBe('signedOut');
  });

  it('deletes a record with another client id even when its install digest matches', async () => {
    const { ports } = await storedSession();
    ports.credentials.value = ports.credentials.value?.replace(
      '"clientId":"native-client"',
      '"clientId":"other-client"',
    );
    const engine = createAuthEngine(CONFIG, ports);

    await engine.restore();

    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot.status).toBe('signedOut');
  });

  it('deletes a valid record when the install identity changes', async () => {
    const { ports } = await storedSession();
    ports.install.result = { kind: 'found', id: 'install-2' };
    const engine = createAuthEngine(CONFIG, ports);

    await engine.restore();

    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot.status).toBe('signedOut');
  });

  it('stores only a digest of the install identity', async () => {
    const { ports } = await storedSession();

    expect(ports.credentials.value).not.toContain('install-1');
  });

  it('keeps sign out in control when invalid-record deletion rejects after its epoch', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.credentials.value = 'corrupt-json';
    const firstDeleteStarted = new Deferred<void>();
    const rejectFirstDelete = new Deferred<void>();
    const signOutDeleteStarted = new Deferred<void>();
    const finishSignOutDelete = new Deferred<void>();
    const restoreSettled = new Deferred<void>();
    let deleteCalls = 0;
    ports.credentials.beforeDelete = () => {
      deleteCalls += 1;
      if (deleteCalls === 1) {
        firstDeleteStarted.resolve();
        return rejectFirstDelete.promise;
      }
      signOutDeleteStarted.resolve();
      return finishSignOutDelete.promise;
    };
    const engine = createAuthEngine(CONFIG, ports);
    const restore = engine.restore().finally(() => restoreSettled.resolve());
    await firstDeleteStarted.promise;

    const signOut = engine.signOut();
    rejectFirstDelete.reject(new Error('delete failed'));
    await signOutDeleteStarted.promise;
    await restoreSettled.promise;

    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.operation).toBe('signingOut');
    finishSignOutDelete.resolve();
    await Promise.all([restore, signOut]);
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });

  it('does not replace sign out with storageBlocked when identity hashing fails late', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    const hashing = new Deferred<void>();
    const hashStarted = new Deferred<void>();
    const deleteStarted = new Deferred<void>();
    const finishDelete = new Deferred<void>();
    const restoreSettled = new Deferred<void>();
    ports.crypto.sha256 = async () => {
      hashStarted.resolve();
      return hashing.promise.then(() => new Uint8Array(32));
    };
    ports.credentials.beforeDelete = () => {
      deleteStarted.resolve();
      return finishDelete.promise;
    };
    const restore = engine.restore().finally(() => restoreSettled.resolve());
    await hashStarted.promise;

    const signOut = engine.signOut();
    await deleteStarted.promise;
    hashing.reject(new Error('hash unavailable'));
    await restoreSettled.promise;

    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.operation).toBe('signingOut');
    finishDelete.resolve();
    await Promise.all([restore, signOut]);
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });

  it('blocks restore when credential reading never finishes', async () => {
    const ports = testPorts(new ScriptedTransport());
    const readStarted = new Deferred<void>();
    ports.credentials.read = async () => {
      readStarted.resolve();
      return new Promise(() => undefined);
    };
    const engine = createAuthEngine(CONFIG, ports);
    const restore = engine.restore();
    await readStarted.promise;

    expect(ports.timer.scheduled).toContain(5_000);
    ports.timer.fireDelay(5_000);

    await expect(restore).resolves.toMatchObject({ kind: 'storageBlocked' });
    expect(engine.snapshot).toMatchObject({ status: 'storageBlocked', operation: 'none' });
    expect(ports.timer.pending).toBe(0);
  });

  it('blocks restore when install identity storage never finishes', async () => {
    const ports = testPorts(new ScriptedTransport());
    const identityStarted = new Deferred<void>();
    ports.install.identity = async () => {
      identityStarted.resolve();
      return new Promise(() => undefined);
    };
    const engine = createAuthEngine(CONFIG, ports);
    const restore = engine.restore();
    await identityStarted.promise;

    expect(ports.timer.scheduled).toContain(5_000);
    ports.timer.fireDelay(5_000);

    await expect(restore).resolves.toMatchObject({
      kind: 'storageBlocked',
      reason: 'installUnavailable',
    });
    expect(engine.snapshot.operation).toBe('none');
    expect(ports.timer.pending).toBe(0);
  });
});
