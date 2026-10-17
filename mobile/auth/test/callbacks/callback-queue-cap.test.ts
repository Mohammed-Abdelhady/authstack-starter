import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  oauthTokenReply,
  redirectFrom,
  successUserReply,
  testPorts,
} from '../support/support';

describe('queued callback capacity', () => {
  it('keeps a valid callback when unrelated links exceed the queue capacity', async () => {
    const firstTransport = new ScriptedTransport();
    const firstPorts = testPorts(firstTransport);
    const first = createAuthEngine(CONFIG, firstPorts);
    await first.restore();
    const opened = new Deferred<string>();
    const browserResult = new Deferred<{ kind: 'cancelled' }>();
    firstPorts.authBrowser.beforeOpen = (address) => opened.resolve(address);
    firstPorts.authBrowser.results.push(() => browserResult.promise);
    const signIn = first.signIn();
    const address = await opened.promise;
    const saved = firstPorts.credentials.value;
    browserResult.resolve({ kind: 'cancelled' });
    await signIn;
    if (!saved) throw new Error('The authorization transaction was not persisted');

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials.value = saved;
    ports.install = firstPorts.install;
    transport.enqueue(oauthTokenReply('queued-access', 'queued-refresh'), successUserReply());
    const engine = createAuthEngine(CONFIG, ports);
    await ports.callbacks.deliver(redirectFrom(address, { code: 'oldest-valid-code' }));
    for (let index = 0; index < 16; index += 1) {
      await ports.callbacks.deliver('sampleapp://products/42');
    }

    await expect(engine.restore()).resolves.toEqual({
      kind: 'restored',
      status: 'signedIn',
    });
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    expect(ports.credentials.value).toContain('queued-refresh');
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
  });

  it('evicts the oldest unknown-state link when the saved transaction is still loading', async () => {
    const sourceTransport = new ScriptedTransport();
    const sourcePorts = testPorts(sourceTransport);
    const source = createAuthEngine(CONFIG, sourcePorts);
    await source.restore();
    const opened = new Deferred<string>();
    const browserResult = new Deferred<{ kind: 'cancelled' }>();
    sourcePorts.authBrowser.beforeOpen = (address) => opened.resolve(address);
    sourcePorts.authBrowser.results.push(() => browserResult.promise);
    const sourceSignIn = source.signIn();
    const authorizationAddress = await opened.promise;
    const saved = sourcePorts.credentials.value;
    browserResult.resolve({ kind: 'cancelled' });
    await sourceSignIn;
    if (!saved) throw new Error('The authorization transaction was not persisted');

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials.value = saved;
    ports.install = sourcePorts.install;
    transport.enqueue(oauthTokenReply('flood-access', 'flood-refresh'), successUserReply());
    const engine = createAuthEngine(
      { ...CONFIG, redirectUri: 'sampleapp://auth/new-callback' },
      ports,
    );
    const readStarted = new Deferred<void>();
    const finishRead = new Deferred<void>();
    const originalRead = ports.credentials.read.bind(ports.credentials);
    ports.credentials.read = async () => {
      readStarted.resolve();
      await finishRead.promise;
      return originalRead();
    };
    const restoring = engine.restore();
    await readStarted.promise;
    const storedState = (JSON.parse(saved) as { transaction: { state: string } }).transaction.state;
    const wrongState = 'AAAAAAAAAAAAAAAAAAAAAA';
    await ports.callbacks.deliver(
      redirectFrom(authorizationAddress, { code: 'noise-first', state: wrongState }),
    );
    await ports.callbacks.deliver(
      redirectFrom(authorizationAddress, { code: 'real-return', state: storedState }),
    );
    for (let index = 0; index < 15; index += 1)
      await ports.callbacks.deliver(
        redirectFrom(authorizationAddress, { code: `noise-${index}`, state: wrongState }),
      );
    finishRead.resolve();

    await expect(restoring).resolves.toEqual({ kind: 'restored', status: 'signedIn' });
    expect(transport.sent.find(({ path }) => path === '/api/oauth/token')?.body).toMatchObject({
      code: 'real-return',
    });
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    engine.dispose();
    source.dispose();
  });

  it('keeps the saved-state callback through a one-junk, one-valid, fifteen-junk flood', async () => {
    const sourceTransport = new ScriptedTransport();
    const sourcePorts = testPorts(sourceTransport);
    const source = createAuthEngine(CONFIG, sourcePorts);
    await source.restore();
    const opened = new Deferred<string>();
    const browserResult = new Deferred<{ kind: 'cancelled' }>();
    sourcePorts.authBrowser.beforeOpen = (address) => opened.resolve(address);
    sourcePorts.authBrowser.results.push(() => browserResult.promise);
    const sourceSignIn = source.signIn();
    const address = await opened.promise;
    const saved = sourcePorts.credentials.value;
    browserResult.resolve({ kind: 'cancelled' });
    await sourceSignIn;
    if (!saved) throw new Error('The authorization transaction was not persisted');

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials.value = saved;
    ports.install = sourcePorts.install;
    transport.enqueue(oauthTokenReply('priority-access', 'priority-refresh'), successUserReply());
    const engine = createAuthEngine(CONFIG, ports);
    await expect(engine.restore()).resolves.toEqual({
      kind: 'restored',
      status: 'signedOut',
    });
    const recordReadStarted = new Deferred<void>();
    const releaseRecordRead = new Deferred<void>();
    const readRecord = ports.credentials.read.bind(ports.credentials);
    let readCount = 0;
    ports.credentials.read = async () => {
      readCount += 1;
      if (readCount === 1) {
        recordReadStarted.resolve();
        await releaseRecordRead.promise;
      }
      return readRecord();
    };
    const restoring = engine.restore();
    await recordReadStarted.promise;
    await ports.callbacks.deliver(redirectFrom(address, { code: 'junk-first', state: 'wrong' }));
    await ports.callbacks.deliver(redirectFrom(address, { code: 'saved-state-code' }));
    for (let index = 0; index < 15; index += 1)
      await ports.callbacks.deliver(
        redirectFrom(address, { code: `junk-${index}`, state: 'wrong' }),
      );
    releaseRecordRead.resolve();

    await expect(restoring).resolves.toEqual({ kind: 'restored', status: 'signedIn' });
    expect(transport.sent.find(({ path }) => path === '/api/oauth/token')?.body).toMatchObject({
      code: 'saved-state-code',
    });
    engine.dispose();
    source.dispose();
  });

  it('uses the saved return address when the current redirect configuration changed', async () => {
    const sourceTransport = new ScriptedTransport();
    const sourcePorts = testPorts(sourceTransport);
    const source = createAuthEngine(CONFIG, sourcePorts);
    await source.restore();
    const opened = new Deferred<string>();
    const browserResult = new Deferred<{ kind: 'cancelled' }>();
    sourcePorts.authBrowser.beforeOpen = (address) => opened.resolve(address);
    sourcePorts.authBrowser.results.push(() => browserResult.promise);
    const sourceSignIn = source.signIn();
    const oldAddress = await opened.promise;
    const saved = sourcePorts.credentials.value;
    browserResult.resolve({ kind: 'cancelled' });
    await sourceSignIn;
    if (!saved) throw new Error('The authorization transaction was not persisted');

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials.value = saved;
    ports.install = sourcePorts.install;
    transport.enqueue(oauthTokenReply('migrated-access', 'migrated-refresh'), successUserReply());
    const migratedConfig = { ...CONFIG, redirectUri: 'sampleapp://auth/new-callback' };
    const engine = createAuthEngine(migratedConfig, ports);
    await expect(engine.restore()).resolves.toEqual({
      kind: 'restored',
      status: 'signedOut',
    });
    const readStarted = new Deferred<void>();
    const releaseRead = new Deferred<void>();
    const readRecord = ports.credentials.read.bind(ports.credentials);
    let readCount = 0;
    ports.credentials.read = async () => {
      readCount += 1;
      if (readCount === 1) {
        readStarted.resolve();
        await releaseRead.promise;
      }
      return readRecord();
    };
    const restoring = engine.restore();
    await readStarted.promise;
    await ports.callbacks.deliver(redirectFrom(oldAddress, { code: 'old-return-address' }));
    releaseRead.resolve();

    await expect(restoring).resolves.toEqual({ kind: 'restored', status: 'signedIn' });
    expect(transport.sent.find(({ path }) => path === '/api/oauth/token')?.body).toMatchObject({
      code: 'old-return-address',
    });
    engine.dispose();
    source.dispose();
  });
});
