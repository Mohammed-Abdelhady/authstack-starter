import { assert, describe, expect, it } from 'vitest';
import { AuthDisposedError } from '../../src';
import { PortDeadlineError } from '../../src/runtime/deadlines';
import { createAuthEngine } from '../support/engine';
import { CONFIG, Deferred, ScriptedTransport, apiReply, testPorts } from '../support/support';

import { METHODS, METHODS_DEADLINE_MS, drainMethods } from './native-methods-fixtures';

describe('native methods reader lifecycle', () => {
  it('coalesces overlapping public reads and forwards a real cancellable GET', async () => {
    const transport = new ScriptedTransport();
    const held = new Deferred<ReturnType<typeof apiReply>>();
    transport.respond = () => held.promise;
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    const first = engine.methods();
    const second = engine.methods();
    await drainMethods();
    const countBeforeReply = transport.sent.length;
    held.resolve(apiReply(METHODS));
    const [one, two] = await Promise.all([first, second]);
    expect(countBeforeReply).toBe(1);
    expect(one.capabilities).toEqual({
      password: true,
      emailLink: false,
      passkeys: false,
      registration: true,
      recovery: true,
    });
    expect(two.capabilities.passkeys).toBe(false);
    assert.isDefined(transport.sent[0]);
    expect(transport.sent[0].signal).toBeDefined();
    expect(transport.sent[0].headers?.['Authorization']).toBeUndefined();
    expect(transport.sent[0].headers?.['Cookie']).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
    engine.dispose();
  });

  it('bounds stalled HTTP callers without releasing the physical lease for retries', async () => {
    const transport = new ScriptedTransport();
    const held = new Deferred<ReturnType<typeof apiReply>>();
    transport.respond = () => held.promise;
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    let earlyError: unknown;
    const first = engine.methods().catch((error: unknown) => {
      earlyError = error;
      return error;
    });
    await drainMethods();
    ports.timer.fireDelay(METHODS_DEADLINE_MS);
    await drainMethods();
    const timedOut = earlyError instanceof PortDeadlineError;
    assert.isDefined(transport.sent[0]);
    const aborted = transport.sent[0].signal?.aborted;
    const retry = engine.methods().catch((error: unknown) => error);
    await drainMethods();
    const retainedCount = transport.sent.length;
    const retainedTimers = ports.timer.pending;
    held.resolve(apiReply(METHODS));
    await Promise.all([first, retry]);
    await drainMethods();
    expect(timedOut).toBe(true);
    expect(aborted).toBe(true);
    expect(retainedCount).toBe(1);
    expect(retainedTimers).toBe(0);
    transport.respond = async () => apiReply(METHODS);
    await engine.methods();
    expect(transport.sent).toHaveLength(2);
    engine.dispose();
  });

  it('settles a read on disposal while an ignoring transport remains pending', async () => {
    const transport = new ScriptedTransport();
    const held = new Deferred<ReturnType<typeof apiReply>>();
    transport.respond = () => held.promise;
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    let earlyError: unknown;
    const read = engine.methods().catch((error: unknown) => {
      earlyError = error;
      return error;
    });
    await drainMethods();
    engine.dispose();
    await drainMethods();
    const disposed = earlyError instanceof AuthDisposedError;
    assert.isDefined(transport.sent[0]);
    const aborted = transport.sent[0].signal?.aborted;
    held.resolve(apiReply(METHODS));
    await read;
    expect(disposed).toBe(true);
    expect(aborted).toBe(true);
    expect(ports.timer.pending).toBe(0);
    const after = await engine.methods().catch((error: unknown) => error);
    expect(after).toBeInstanceOf(AuthDisposedError);
    expect(transport.sent).toHaveLength(1);
  });

  it('holds its lease until stalled platform readiness physically settles', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async () => apiReply(METHODS);
    const ports = testPorts(transport);
    const held = new Deferred<boolean>();
    let checks = 0;
    const engine = createAuthEngine(CONFIG, {
      ...ports,
      passkeys: {
        available: () => {
          checks += 1;
          return held.promise;
        },
        authenticate: async () => ({ kind: 'cancelled' }),
      },
    });
    let earlyError: unknown;
    const first = engine.methods().catch((error: unknown) => {
      earlyError = error;
      return error;
    });
    await drainMethods();
    ports.timer.fireDelay(METHODS_DEADLINE_MS);
    await drainMethods();
    const timedOut = earlyError instanceof PortDeadlineError;
    const second = engine.methods().catch((error: unknown) => error);
    await drainMethods();
    const readsBeforeSettlement = transport.sent.length;
    const checksBeforeSettlement = checks;
    held.resolve(true);
    await Promise.all([first, second]);
    await drainMethods();
    expect(timedOut).toBe(true);
    expect(readsBeforeSettlement).toBe(1);
    expect(checksBeforeSettlement).toBe(1);
    await engine.methods();
    expect(transport.sent).toHaveLength(2);
    engine.dispose();
  });
});
