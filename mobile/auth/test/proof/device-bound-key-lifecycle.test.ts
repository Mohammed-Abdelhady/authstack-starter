import { REFRESH_1_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { parseStoredRecord } from '../../src/storage/persistence';
import { createAuthEngine } from '../support/engine';
import {
  dpopTokenReply,
  enqueueBoundRefresh,
  establishBoundSession,
  refreshRequests,
} from '../support/device-bound-support';
import { FIXED_PUBLIC_JWK, SoftwareDeviceKey } from '../support/software-device-key';
import {
  CONFIG,
  REFRESH_TOKEN,
  ScriptedTransport,
  acceptCode,
  successUserReply,
  testPorts,
} from '../support/support';

describe('device-bound key lifecycle', () => {
  it('returns a transient storage block when the stored key is unavailable, then restores it', async () => {
    const established = await establishBoundSession();
    const record = established.ports.credentials.value;
    established.engine.dispose();

    const transport = new ScriptedTransport();
    const deviceKey = new SoftwareDeviceKey();
    deviceKey.publicKeyResult = { kind: 'unavailable' };
    const ports = testPorts(transport, deviceKey);
    ports.credentials.value = record;
    const engine = createAuthEngine(CONFIG, ports);

    expect(await engine.restore()).toEqual({
      kind: 'storageBlocked',
      reason: 'deviceKeyUnavailable',
    });
    expect(ports.credentials.value).toBe(record);

    deviceKey.publicKeyResult = undefined;
    expect(await engine.restore()).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(engine.snapshot.status).toBe('signedIn');
    expect(transport.sent).toEqual([]);
  });

  it('requires sign-in when the stored thumbprint belongs to another key', async () => {
    const established = await establishBoundSession();
    const record = established.ports.credentials.value;
    established.engine.dispose();

    const transport = new ScriptedTransport();
    const otherDeviceKey = new SoftwareDeviceKey();
    otherDeviceKey.publicKeyResult = {
      kind: 'success',
      value: { ...FIXED_PUBLIC_JWK, x: 'A'.repeat(43) },
    };
    const ports = testPorts(transport, otherDeviceKey);
    ports.credentials.value = record;
    const engine = createAuthEngine(CONFIG, ports);

    expect(await engine.restore()).toEqual({ kind: 'restored', status: 'reauthRequired' });
    expect(engine.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'deviceKeyInvalidated',
    });
    expect(transport.sent).toEqual([]);
    expect(parseStoredRecord(ports.credentials.value ?? '')?.proofKeyThumbprint).toBe(
      parseStoredRecord(record ?? '')?.proofKeyThumbprint,
    );
  });

  it('requires sign-in when the key is invalidated between two refreshes', async () => {
    const { engine, ports, transport, deviceKey } = await establishBoundSession();
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      dpopTokenReply('access-1', REFRESH_1_TOKEN),
      successUserReply(),
    );
    ports.clock.advance(270_000);
    await engine.transport.request({ method: 'GET', path: '/api/user/profile' });
    const sentBeforeFailure = refreshRequests(transport).length;

    deviceKey.publicKeyResult = { kind: 'keyInvalidated' };
    ports.clock.advance(270_000);
    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toMatchObject({ reason: 'keyInvalidated' });

    expect(refreshRequests(transport)).toHaveLength(sentBeforeFailure);
    expect(engine.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'deviceKeyInvalidated',
    });
    expect(parseStoredRecord(ports.credentials.value ?? '')?.tokens?.refreshToken).toBe(
      REFRESH_1_TOKEN,
    );
  });

  it('refuses a valid but different key between two refreshes', async () => {
    const { engine, ports, transport, deviceKey } = await establishBoundSession();
    enqueueBoundRefresh(
      transport,
      REFRESH_TOKEN,
      dpopTokenReply('access-1', REFRESH_1_TOKEN),
      successUserReply(),
    );
    ports.clock.advance(270_000);
    await engine.transport.request({ method: 'GET', path: '/api/user/profile' });
    deviceKey.publicKeyResult = {
      kind: 'success',
      value: { ...FIXED_PUBLIC_JWK, x: 'A'.repeat(43) },
    };
    ports.clock.advance(270_000);

    await expect(
      engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
    ).rejects.toMatchObject({ reason: 'thumbprintMismatch' });

    expect(refreshRequests(transport)).toHaveLength(2);
    expect(engine.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'deviceKeyInvalidated',
    });
  });
});

describe('device-bound exchange failures', () => {
  it.each([
    ['unavailable', { kind: 'unavailable' as const }],
    ['cancelled', { kind: 'cancelled' as const }],
    ['invalidated', { kind: 'keyInvalidated' as const }],
  ])('reports the %s key failure as a device-key outcome', async (_name, result) => {
    const transport = new ScriptedTransport();
    const deviceKey = new SoftwareDeviceKey();
    deviceKey.publicKeyResult = result;
    const ports = testPorts(transport, deviceKey);
    acceptCode(ports.authBrowser, 'key-failure-code');
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    expect(await engine.signIn()).toEqual({ kind: 'deviceKeyFailure', reason: result.kind });
    expect(transport.sent).toEqual([]);
  });

  it('returns the required-binding outcome with the mapped reason', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport, new SoftwareDeviceKey());
    transport.enqueue({
      status: 400,
      body: { error: 'invalid_dpop_proof', error_description: 'NATIVE_DPOP_REQUIRED' },
    });
    acceptCode(ports.authBrowser, 'required-code');
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    expect(await engine.signIn()).toEqual({ kind: 'deviceBindingRequired' });
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', reason: 'deviceBindingRequired' });
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
  });
});
