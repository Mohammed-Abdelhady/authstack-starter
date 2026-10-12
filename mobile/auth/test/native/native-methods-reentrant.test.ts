import { describe, expect, it } from 'vitest';
import { AuthDisposedError } from '../../src';
import { createAuthEngine } from '../support/engine';
import { CONFIG, Deferred, ScriptedTransport, apiReply, testPorts } from '../support/support';
import { GOOGLE_METHODS, drainMethods } from './native-methods-fixtures';

describe('reentrant methods availability cancellation', () => {
  it('starts no later SDK check when the first check disposes synchronously', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const held = new Deferred<boolean>();
    const checked: string[] = [];
    transport.respond = async () =>
      apiReply({
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
      });
    const engine = createAuthEngine(CONFIG, {
      ...ports,
      providerSignIn: {
        available: (method) => {
          checked.push(method.id);
          if (method.id === 'google') {
            engine.dispose();
            return held.promise;
          }
          return Promise.resolve(true);
        },
        authenticate: async () => ({ kind: 'cancelled' }),
      },
    });
    const failure = await engine.methods().catch((error: unknown) => error);
    held.resolve(true);
    await drainMethods();
    expect(failure).toBeInstanceOf(AuthDisposedError);
    expect(checked).toEqual(['google']);
    expect(ports.timer.pending).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });
});
