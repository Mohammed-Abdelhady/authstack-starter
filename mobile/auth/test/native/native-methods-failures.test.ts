import { describe, expect, it } from 'vitest';
import { ApiError, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { AuthDisposedError } from '../../src';
import { PortDeadlineError } from '../../src/runtime/deadlines';
import { createAuthEngine } from '../support/engine';
import { CONFIG, ScriptedTransport, apiReply, failedApiReply, testPorts } from '../support/support';
import { GOOGLE_METHODS, METHODS, drainMethods } from './native-methods-fixtures';

describe('native methods failure and freshness', () => {
  it.each([
    { name: 'API refusal', reply: failedApiReply(503, 'NATIVE_UNAVAILABLE'), error: ApiError },
    { name: 'malformed catalogue', reply: apiReply(null), error: ApiError },
    {
      name: 'offline transport',
      reply: new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      error: TransportError,
    },
  ])('rejects $name without caching an empty catalogue', async ({ reply, error }) => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    transport.enqueue(reply, apiReply(METHODS));
    const engine = createAuthEngine(CONFIG, ports);
    const result = await engine.methods().catch((failure: unknown) => failure);
    expect(result).toBeInstanceOf(error);
    expect(ports.timer.pending).toBe(0);
    const fresh = await engine.methods();
    expect(fresh.capabilities.password).toBe(true);
    expect(transport.sent).toHaveLength(2);
    expect(ports.timer.pending).toBe(0);
    engine.dispose();
  });

  it('rechecks the actual SDK and server catalogue on every settled read', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    let available = true;
    transport.enqueue(apiReply(GOOGLE_METHODS), apiReply(GOOGLE_METHODS), apiReply(METHODS));
    const engine = createAuthEngine(CONFIG, {
      ...ports,
      providerSignIn: {
        available: async () => available,
        authenticate: async () => ({ kind: 'cancelled' }),
      },
    });
    const first = await engine.methods();
    available = false;
    const second = await engine.methods();
    const third = await engine.methods();
    expect(first.providers[0].mode).toBe('googleIdentityToken');
    expect(second.providers).toEqual([{ id: 'google', displayName: 'Google', mode: 'system' }]);
    expect(third.providers).toEqual([]);
    expect(transport.sent).toHaveLength(3);
    engine.dispose();
  });

  it.each(['throw', 'immediateTimeout', 'dispose'] as const)(
    'starts no GET when deadline setup encounters %s',
    async (scenario) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      const engine = createAuthEngine(CONFIG, ports);
      const failure = new Error('timer scheduling failed');
      ports.timer.after = (_milliseconds, callback) => {
        if (scenario === 'throw') throw failure;
        if (scenario === 'immediateTimeout') callback();
        else engine.dispose();
        return () => undefined;
      };
      const result = await engine.methods().catch((error: unknown) => error);
      await drainMethods();
      expect(result).toBeInstanceOf(
        scenario === 'dispose'
          ? AuthDisposedError
          : scenario === 'throw'
            ? Error
            : PortDeadlineError,
      );
      if (scenario === 'throw') expect(result).toBe(failure);
      expect(transport.sent).toHaveLength(0);
      expect(ports.timer.pending).toBe(0);
      engine.dispose();
    },
  );
});
