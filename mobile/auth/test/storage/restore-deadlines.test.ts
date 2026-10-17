import { describe, expect, it } from 'vitest';
import type { LaunchAddressResult } from '../../src';
import { createAuthEngine } from '../support/engine';
import { CONFIG, Deferred, ScriptedTransport, testPorts } from '../support/support';

describe('restore port deadlines', () => {
  it('bounds the cold-start callback read', async () => {
    const ports = testPorts(new ScriptedTransport());
    const address = new Deferred<LaunchAddressResult>();
    const started = new Deferred<void>();
    ports.callbacks.initialAddress = () => {
      started.resolve();
      return address.promise;
    };
    const engine = createAuthEngine(CONFIG, ports);
    const restore = engine.restore();
    await started.promise;
    const timerWasScheduled = ports.timer.pending > 0;
    if (timerWasScheduled) ports.timer.fireDelay(5_000);
    address.resolve({ kind: 'none' });
    const result = await restore;

    expect(timerWasScheduled).toBe(true);
    expect(result).toEqual({ kind: 'restored', status: 'signedOut' });
    expect(engine.snapshot.operation).toBe('none');
  });

  it('bounds the install digest during restore', async () => {
    const ports = testPorts(new ScriptedTransport());
    const digest = new Deferred<Uint8Array>();
    const started = new Deferred<void>();
    ports.crypto.sha256 = () => {
      started.resolve();
      return digest.promise;
    };
    const engine = createAuthEngine(CONFIG, ports);
    const restore = engine.restore();
    await started.promise;
    const timerWasScheduled = ports.timer.pending > 0;
    if (timerWasScheduled) ports.timer.fireDelay(5_000);
    digest.resolve(new Uint8Array(32).fill(9));
    const result = await restore;

    expect(timerWasScheduled).toBe(true);
    expect(result).toEqual({ kind: 'storageBlocked', reason: 'installUnavailable' });
    expect(engine.snapshot.operation).toBe('none');
  });
});
