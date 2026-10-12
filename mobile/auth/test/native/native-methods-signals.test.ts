import { describe, expect, it } from 'vitest';
import { createApiClient, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import type { AbortSignalPort } from '../../src';
import { PortAbortController } from '../../src';
import { AuthRuntime } from '../../src/runtime/runtime';
import { createNativeMethodsReader } from '../../src/native/native-methods-reader';
import { CONFIG, Deferred, ScriptedTransport, apiReply, testPorts } from '../support/support';
import { METHODS, METHODS_DEADLINE_MS, drainMethods } from './native-methods-fixtures';

function signalFixture() {
  const controller = new PortAbortController();
  const listeners = new Set<() => void>();
  const signal: AbortSignalPort = {
    get aborted() {
      return controller.signal.aborted;
    },
    addEventListener: (event, listener) => {
      listeners.add(listener);
      controller.signal.addEventListener(event, listener);
    },
    removeEventListener: (event, listener) => {
      listeners.delete(listener);
      controller.signal.removeEventListener(event, listener);
    },
  };
  return { signal, controller, listeners };
}

describe('private methods cancellation signal contract', () => {
  it('refuses pre-aborted callers without cancelling an unrelated live read', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const read = createNativeMethodsReader(
      runtime,
      createApiClient(transport),
      METHODS_DEADLINE_MS,
    );
    const held = new Deferred<ReturnType<typeof apiReply>>();
    transport.respond = () => held.promise;
    const pending = read();
    const caller = signalFixture();
    caller.controller.abort();
    const refused = await read(caller.signal).catch((error: unknown) => error);
    await drainMethods();
    expect(refused).toBeInstanceOf(TransportError);
    if (refused instanceof TransportError) expect(refused.reason).toBe(TRANSPORT_FAILURE.ABORTED);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].signal?.aborted).toBe(false);
    expect(caller.listeners.size).toBe(0);
    held.resolve(apiReply(METHODS));
    expect((await pending).capabilities.password).toBe(true);
    runtime.dispose();
  });

  it.each(['success', 'cancel', 'timeout', 'dispose'] as const)(
    'removes caller signal listeners after %s, even before physical settlement',
    async (scenario) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      const runtime = new AuthRuntime(CONFIG, ports);
      const read = createNativeMethodsReader(
        runtime,
        createApiClient(transport),
        METHODS_DEADLINE_MS,
      );
      const held = new Deferred<ReturnType<typeof apiReply>>();
      transport.respond = () => held.promise;
      const caller = signalFixture();
      const first = read(caller.signal).catch((error: unknown) => error);
      const second = read(caller.signal).catch((error: unknown) => error);
      await drainMethods();
      expect(caller.listeners.size).toBe(1);
      if (scenario === 'success') held.resolve(apiReply(METHODS));
      if (scenario === 'cancel') caller.controller.abort();
      if (scenario === 'timeout') ports.timer.fireDelay(METHODS_DEADLINE_MS);
      if (scenario === 'dispose') runtime.dispose();
      await Promise.all([first, second]);
      expect(caller.listeners.size).toBe(0);
      expect(ports.timer.pending).toBe(0);
      held.resolve(apiReply(METHODS));
      await drainMethods();
      expect(transport.sent).toHaveLength(1);
      runtime.dispose();
    },
  );
});
