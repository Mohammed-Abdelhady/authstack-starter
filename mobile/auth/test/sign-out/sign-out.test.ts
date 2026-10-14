import { REFRESH_1_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, TransportError, TRANSPORT_FAILURE, type TransportSignal } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import type { InstallIdentityResult } from '../../src';
import { revokedTokens } from '../support/tracking';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  REVOKE_TIMEOUT_MS,
  ScriptedTransport,
  apiReply,
  acceptCode,
  establishSession,
  oauthTokenReply,
  successUserReply,
  testPorts,
} from '../support/support';

describe('sign out', () => {
  it('finishes an accepted sign-out when disposal follows in the same tick', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const revokeStarted = new Deferred<void>();
    const deleteFinished = new Deferred<void>();
    ports.credentials.afterDelete = () => deleteFinished.resolve();
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/revoke') revokeStarted.resolve();
    };
    transport.enqueue({ status: 200, body: {} });

    const signingOut = engine.signOut();
    engine.dispose();

    await expect(signingOut).resolves.toEqual({ kind: 'disposed' });
    await Promise.all([revokeStarted.promise, deleteFinished.promise]);
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
  });

  it('revokes the persisted refresh token from an interrupted refresh record', async () => {
    const firstTransport = new ScriptedTransport();
    const firstPorts = testPorts(firstTransport);
    const first = createAuthEngine(CONFIG, firstPorts);
    await establishSession(first, firstPorts, firstTransport);
    const serialized = firstPorts.credentials.value;
    expect(serialized).toBeDefined();
    firstPorts.credentials.value = serialized?.replace(
      '"tokens":',
      '"refreshInFlight":true,"tokens":',
    );

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials = firstPorts.credentials;
    ports.install = firstPorts.install;
    transport.enqueue({ status: 200, body: {} });
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    expect(engine.snapshot.status).toBe('reauthRequired');

    const result = await engine.signOut();

    expect(result).toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
    expect(transport.sent.findIndex(({ path }) => path === '/api/oauth/revoke')).toBeLessThan(
      ports.credentials.events.indexOf('delete:start'),
    );
  });

  it('raises the sign-out epoch and clears memory before storage resolves', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const deletion = new Deferred<void>();
    ports.credentials.beforeDelete = () => deletion.promise;
    transport.enqueue({ status: 200, body: {} });

    const pending = engine.signOut();

    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.operation).toBe('signingOut');
    deletion.resolve();
    await pending;
    expect(engine.snapshot.operation).toBe('none');
  });

  it('reads and revokes a saved session when sign-out interrupts restore', async () => {
    const firstTransport = new ScriptedTransport();
    const firstPorts = testPorts(firstTransport);
    const first = createAuthEngine(CONFIG, firstPorts);
    await establishSession(first, firstPorts, firstTransport);

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials = firstPorts.credentials;
    const identity = new Deferred<InstallIdentityResult>();
    const identityStarted = new Deferred<void>();
    ports.install.identity = () => {
      identityStarted.resolve();
      return identity.promise;
    };
    transport.enqueue({ status: 200, body: {} });
    const engine = createAuthEngine(CONFIG, ports);
    const restore = engine.restore();
    await identityStarted.promise;

    const result = await engine.signOut();
    identity.resolve({ kind: 'found', id: 'install-1' });
    await restore;

    expect(result).toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
  });

  it('reports when sign-out cannot read the stored session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials.readResult = { kind: 'locked' };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    expect(engine.snapshot.status).toBe('storageBlocked');

    const result = await engine.signOut();

    expect(result).toMatchObject({ kind: 'signedOut', revocation: 'recordUnavailable' });
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/revoke')).toHaveLength(0);
  });

  it('shares sign out with a subscriber called during the immediate state change', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue({ status: 200, body: {} });
    let nested: Promise<{ kind: string }> | undefined;
    engine.subscribe((snapshot) => {
      if (snapshot.operation === 'signingOut' && !nested) nested = engine.signOut();
    });

    const first = engine.signOut();

    expect(nested).toBe(first);
    await first;
  });

  it('deletes local credentials and does not retry a failed revoke', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue({ status: 400, body: { error: 'invalid_request' } });

    const result = await engine.signOut();
    await engine.signOut();

    expect(result.kind).toBe('signedOut');
    expect(ports.credentials.value).toBeUndefined();
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(transport.sent.some(({ path }) => path === '/api/auth/logout')).toBe(false);
  });

  it('keeps local sign out and attempts revocation when credential deletion fails', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.credentials.beforeDelete = () => Promise.reject(new Error('storage unavailable'));
    transport.enqueue({ status: 200, body: {} });

    const result = await engine.signOut();

    expect(result).toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    expect(result.error?.constructor).toBe(Error);
    expect(engine.snapshot).toMatchObject({
      status: 'signedOut',
      operation: 'none',
      warning: 'storageBlocked',
      reason: 'storageFailure',
    });
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
  });

  it('aborts revoke at the deadline and settles local sign out', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    let revokeSignal: TransportSignal | undefined;
    const revokeStarted = new Deferred<void>();
    transport.enqueue((request) => {
      revokeSignal = request.signal;
      return never.promise;
    });
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/revoke') revokeStarted.resolve();
    };
    const never = new Deferred<{ status: number; body: unknown }>();

    const pending = engine.signOut();
    await revokeStarted.promise;
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.timer.scheduled).toContain(REVOKE_TIMEOUT_MS);
    ports.timer.fireAll();
    const result = await pending;

    expect(result.kind).toBe('signedOut');
    expect(result.revocation).toBe('timedOut');
    expect(revokeSignal?.aborted).toBe(true);
    expect(ports.timer.pending).toBe(0);
  });

  it('starts revoke while deletion is pending and times deletion out', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const deleteStarted = new Deferred<void>();
    const revokeStarted = new Deferred<void>();
    ports.credentials.beforeDelete = () => {
      deleteStarted.resolve();
      return new Promise(() => undefined);
    };
    transport.enqueue({ status: 200, body: {} });
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/revoke') revokeStarted.resolve();
    };

    const signOut = engine.signOut();
    await deleteStarted.promise;
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/revoke')).toHaveLength(1);
    expect(ports.timer.scheduled).toContain(4_000);
    await revokeStarted.promise;
    ports.timer.fireDelay(4_000);

    await expect(signOut).resolves.toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    expect(engine.snapshot.operation).toBe('none');
    expect(ports.timer.pending).toBe(0);
  });

  it('serializes an earlier storage write before deletion and never opens its browser', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const entered = new Deferred<void>();
    const replace = new Deferred<void>();
    ports.credentials.beforeReplace = () => {
      entered.resolve();
      return replace.promise;
    };
    const signIn = engine.signIn();
    await entered.promise;
    const signOut = engine.signOut();
    expect(engine.snapshot.status).toBe('signedOut');
    replace.resolve();
    await Promise.all([signIn, signOut]);

    expect(ports.credentials.value).toBeUndefined();
    expect(ports.authBrowser.opened).toHaveLength(0);
    expect(ports.credentials.events.indexOf('replace:done')).toBeLessThan(
      ports.credentials.events.indexOf('delete:start'),
    );
  });

  it('does not refresh just because time advances, then refreshes for the next request', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    expect(engine.snapshot.operation).toBe('none');
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile' }));

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
    expect(ports.timer.pending).toBe(0);
  });

  it('cleans up timer callbacks after every settled operation', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    transport.enqueue(oauthTokenReply(), successUserReply());
    acceptCode(ports.authBrowser);
    expect(ports.timer.pending).toBe(0);
    await expect(engine.signIn()).resolves.toMatchObject({ kind: 'signedIn' });
    expect(ports.timer.pending).toBe(0);
    ports.clock.advance(270_000);
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile' }));
    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    expect(ports.timer.pending).toBe(0);
    transport.enqueue({ status: 200, body: {} });
    await engine.signOut();
    expect(ports.timer.pending).toBe(0);
  });

  it('does not refresh after a GET no-response retry cap is reached', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
    );

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(TransportError);

    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(3);
    expect(ports.timer.pending).toBe(0);
  });
});
