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

  it('reports a sign-out the locked store refused as not saved, then finishes it', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.credentials.writeResult = { kind: 'locked' };

    const refused = await engine.signOut();

    expect(refused.kind).toBe('signOutNotSaved');
    expect(refused.error).toBeInstanceOf(CredentialStoreError);
    expect(refused.error).toMatchObject({ operation: 'credentials.replace', condition: 'locked' });
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    expect(ports.credentials.value).toContain(REFRESH_TOKEN);
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/revoke')).toHaveLength(0);

    ports.credentials.writeResult = undefined;
    transport.enqueue({ status: 200, body: {} });

    await expect(engine.signOut()).resolves.toEqual({ kind: 'signedOut', revocation: 'revoked' });
    expect(ports.credentials.value).toBeUndefined();
  });
});
