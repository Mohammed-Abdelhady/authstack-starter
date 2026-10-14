import { describe, expect, it } from 'vitest';
import { CredentialStoreError } from '../../src';
import { createAuthEngine } from '../support/engine';
import {
  REFRESH_TOKEN,
  CONFIG,
  ScriptedTransport,
  establishSession,
  testPorts,
} from '../support/support';

describe('restore while the device is locked', () => {
  it('reports a locked install identity as locked and leaves the record alone', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.credentials.value = 'saved-record';
    ports.install.result = { kind: 'locked' };
    const engine = createAuthEngine(CONFIG, ports);

    const outcome = await engine.restore();

    expect(outcome).toEqual({ kind: 'storageBlocked', reason: 'locked' });
    expect(engine.snapshot).toEqual({
      status: 'storageBlocked',
      operation: 'none',
      reason: 'storageFailure',
    });
    expect(ports.credentials.value).toBe('saved-record');
    expect(ports.credentials.events).toEqual([]);
  });

  it('restores the session once the install identity can be read', async () => {
    const transport = new ScriptedTransport();
    const signedInPorts = testPorts(transport);
    await establishSession(createAuthEngine(CONFIG, signedInPorts), signedInPorts, transport);
    const ports = testPorts(new ScriptedTransport());
    ports.credentials = signedInPorts.credentials;
    ports.install.result = { kind: 'locked' };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.install.result = { kind: 'found', id: 'install-1' };

    const outcome = await engine.restore();

    expect(outcome).toEqual({ kind: 'restored', status: 'signedIn' });
  });

  it('reports an owed delete the locked store refused as locked, then finishes it', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue({ status: 200, body: {} });
    ports.credentials.writeResult = { kind: 'locked' };

    const signOut = await engine.signOut();

    expect(signOut.kind).toBe('signedOut');
    expect(signOut.revocation).toBe('revoked');
    expect(signOut.error).toBeInstanceOf(CredentialStoreError);
    expect(signOut.error).toMatchObject({ operation: 'credentials.delete', condition: 'locked' });
    expect(engine.snapshot).toEqual({
      status: 'signedOut',
      operation: 'none',
      warning: 'storageBlocked',
      reason: 'storageFailure',
    });

    const blocked = await engine.restore();

    expect(blocked).toEqual({ kind: 'storageBlocked', reason: 'locked' });
    expect(ports.credentials.value).toContain(REFRESH_TOKEN);

    ports.credentials.writeResult = undefined;
    const restored = await engine.restore();

    expect(restored).toEqual({ kind: 'restored', status: 'signedOut' });
    expect(ports.credentials.value).toBeUndefined();
  });
});
