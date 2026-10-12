import { describe, expect, it } from 'vitest';
import { AuthDisposedError } from '../../src';
import { PortDeadlineError } from '../../src/runtime/deadlines';
import { createAuthEngine } from '../support/engine';
import { CONFIG, Deferred, ScriptedTransport, apiReply, testPorts } from '../support/support';
import { GOOGLE_METHODS, METHODS_DEADLINE_MS, drainMethods } from './native-methods-fixtures';

describe('native methods platform readiness lease', () => {
  it('retains parallel SDK work until every pending readiness check settles', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const google = new Deferred<boolean>();
    const apple = new Deferred<boolean>();
    let checks = 0;
    const methods = {
      ...GOOGLE_METHODS,
      methods: {
        ...GOOGLE_METHODS.methods,
        oauth: [
          { id: 'google', displayName: 'Google' },
          { id: 'apple', displayName: 'Apple' },
        ],
      },
      providers: [
        ...GOOGLE_METHODS.providers,
        {
          id: 'apple',
          displayName: 'Apple',
          mode: 'appleIdentityTokenAndCode',
          sdk: { kind: 'apple', appId: 'apple-app' },
        },
      ],
    };
    transport.respond = async () => apiReply(methods);
    const engine = createAuthEngine(CONFIG, {
      ...ports,
      providerSignIn: {
        available: (method) => {
          checks += 1;
          return method.id === 'google' ? google.promise : apple.promise;
        },
        authenticate: async () => ({ kind: 'cancelled' }),
      },
    });
    const first = engine.methods().catch((error: unknown) => error);
    await drainMethods();
    ports.timer.fireDelay(METHODS_DEADLINE_MS);
    expect(await first).toBeInstanceOf(PortDeadlineError);
    google.reject(new Error('SDK unavailable'));
    await drainMethods();
    const joined = await engine.methods().catch((error: unknown) => error);
    expect(joined).toBeInstanceOf(PortDeadlineError);
    expect(transport.sent).toHaveLength(1);
    expect(checks).toBe(2);
    apple.resolve(true);
    await drainMethods();
    const fresh = await engine.methods();
    expect(fresh.providers.map(({ mode }) => mode)).toEqual([
      'system',
      'appleIdentityTokenAndCode',
    ]);
    expect(transport.sent).toHaveLength(2);
    expect(checks).toBe(4);
    engine.dispose();
  });

  it('does not begin provider readiness after a disposed passkey check resolves late', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const held = new Deferred<boolean>();
    let providersChecked = 0;
    transport.respond = async () => apiReply(GOOGLE_METHODS);
    const engine = createAuthEngine(CONFIG, {
      ...ports,
      passkeys: {
        available: () => held.promise,
        authenticate: async () => ({ kind: 'cancelled' }),
      },
      providerSignIn: {
        available: async () => {
          providersChecked += 1;
          return true;
        },
        authenticate: async () => ({ kind: 'cancelled' }),
      },
    });
    const read = engine.methods().catch((error: unknown) => error);
    await drainMethods();
    engine.dispose();
    expect(await read).toBeInstanceOf(AuthDisposedError);
    held.resolve(true);
    await drainMethods();
    expect(providersChecked).toBe(0);
    expect(ports.timer.pending).toBe(0);
  });
});
