import { describe, expect, it } from 'vitest';
import { AuthSessionError } from '../../src';
import type { DeviceKeyResult, Es256PublicJwk } from '../../src';
import { challengeThen, establishBoundSession } from '../support/device-bound-support';
import { createAuthEngine } from '../support/engine';
import { HeldDeviceKey } from '../support/held-device-key';
import { queuedWorkDone } from '../support/queued-work';
import { FIXED_PUBLIC_JWK } from '../support/software-device-key';
import { CONFIG, ScriptedTransport, testPorts } from '../support/support';

const KEY_READ = {
  success: { kind: 'success', value: FIXED_PUBLIC_JWK },
  keyInvalidated: { kind: 'keyInvalidated' },
  unavailable: { kind: 'unavailable' },
} satisfies Record<string, DeviceKeyResult<Es256PublicJwk>>;

/** A bound revoke is challenged first, so it takes two requests. */
const REVOKE_ROUND_TRIPS = ['/api/oauth/revoke', '/api/oauth/revoke'];

/** A fresh engine over a saved device-bound record, with its first key read held open. */
async function restoreWithHeldKey() {
  const established = await establishBoundSession();
  const record = established.ports.credentials.value;
  established.engine.dispose();
  const transport = new ScriptedTransport();
  const deviceKey = new HeldDeviceKey();
  const keyRead = deviceKey.holdNextPublicKey();
  const ports = testPorts(transport, deviceKey);
  ports.credentials.value = record;
  const engine = createAuthEngine(CONFIG, ports);
  const restore = engine.restore();
  await deviceKey.readStarted.promise;
  return { engine, ports, transport, keyRead, restore, record };
}

describe('restore across a device key read', () => {
  it.each(Object.entries(KEY_READ))(
    'stays signed out when sign-out lands before the key read answers %s',
    async (_answer, result) => {
      const { engine, ports, transport, keyRead, restore } = await restoreWithHeldKey();
      transport.enqueue(...challengeThen({ status: 200, body: {} }));

      const signedOut = await engine.signOut();
      const sentBySignOut = transport.sent.map(({ path }) => path);
      const eventsBySignOut = [...ports.credentials.events];
      keyRead.resolve(result);
      const restored = await restore;

      expect(signedOut).toEqual({ kind: 'signedOut', revocation: 'revoked' });
      expect(sentBySignOut).toEqual(REVOKE_ROUND_TRIPS);
      expect(restored).toEqual({ kind: 'restored', status: 'signedOut' });
      expect(engine.snapshot).toEqual({ status: 'signedOut', operation: 'none' });
      await expect(
        engine.transport.request({ method: 'GET', path: '/api/user/profile' }),
      ).rejects.toBeInstanceOf(AuthSessionError);
      expect(ports.credentials.value).toBeUndefined();
      expect(ports.credentials.events).toEqual(eventsBySignOut);
      expect(transport.sent.map(({ path }) => path)).toEqual(REVOKE_ROUND_TRIPS);
      expect(ports.callbacks.initialCalls).toBe(0);
    },
  );

  it.each(Object.entries(KEY_READ))(
    'stays disposed when dispose lands before the key read answers %s',
    async (_answer, result) => {
      const { engine, ports, transport, keyRead, restore, record } = await restoreWithHeldKey();
      engine.dispose();
      const eventsByDispose = [...ports.credentials.events];
      keyRead.resolve(result);
      const restored = await restore;
      await queuedWorkDone();

      expect(restored).toEqual({ kind: 'disposed' });
      expect(engine.snapshot).toEqual({ status: 'signedOut', operation: 'none' });
      expect(ports.credentials.value).toBe(record);
      expect(ports.credentials.events).toEqual(eventsByDispose);
      expect(transport.sent).toEqual([]);
      expect(ports.callbacks.initialCalls).toBe(0);
      expect(ports.timer.pending).toBe(0);
    },
  );
});
