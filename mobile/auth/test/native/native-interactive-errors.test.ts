import { describe, expect, it } from 'vitest';
import { Deferred, apiReply } from '../support/support';
import { BROWSER_AUTHORIZATION_TIMEOUT_MS } from '../../src/constants';
import { drainMethods } from './native-methods-fixtures';
import { INTERACTIVE_KIND, interactiveScenario } from './native-interactive-fixtures';

describe('native interactive boundary failures', () => {
  it.each(INTERACTIVE_KIND)(
    'starts no queued %s prompt after the effective lifetime elapses',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      scenario.ports.timer.onSchedule = (milliseconds) => {
        if (milliseconds === BROWSER_AUTHORIZATION_TIMEOUT_MS)
          scenario.ports.clock.advance(milliseconds + 1);
      };
      const action = scenario.engine.nativeSignIn(scenario.action);
      await drainMethods();
      const started = { ...scenario.counts };
      scenario.complete(true);
      const result = await action;
      scenario.engine.dispose();
      expect(result.kind).toBe('expired');
      expect(started).toEqual({ provider: 0, passkey: 0 });
      expect(scenario.ports.timer.pending).toBe(0);
    },
  );

  it('starts no passkey setup work after cancellation before the queued operation', async () => {
    const scenario = await interactiveScenario('passkey');
    let checked = 0;
    scenario.availability.passkey = async () => {
      checked += 1;
      return true;
    };
    const action = scenario.engine.nativeSignIn(scenario.action);
    await scenario.engine.cancelNativeSignIn();
    const result = await action;
    scenario.complete(false);
    scenario.engine.dispose();
    expect(result.kind).toBe('signedOut');
    expect(checked).toBe(0);
    expect(scenario.counts).toEqual({ provider: 0, passkey: 0 });
    expect(scenario.ports.timer.pending).toBe(0);
  });

  it.each(INTERACTIVE_KIND)(
    'returns the cancelled %s prompt outcome without an artifact',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      const action = scenario.engine.nativeSignIn(scenario.action);
      await scenario.prompted.promise;
      scenario.complete(false);
      const result = await action;
      scenario.engine.dispose();
      expect(result.kind).toBe('cancelled');
      expect(scenario.ports.timer.pending).toBe(0);
    },
  );

  it.each(['throw', 'immediateTimeout', 'dispose'] as const)(
    'starts no platform prompt after interactive timer setup %s',
    async (fault) => {
      const scenario = await interactiveScenario('provider');
      const original = scenario.ports.timer.after.bind(scenario.ports.timer);
      scenario.ports.timer.after = (milliseconds, callback) => {
        if (milliseconds !== BROWSER_AUTHORIZATION_TIMEOUT_MS)
          return original(milliseconds, callback);
        if (fault === 'throw') throw new Error('timer unavailable');
        if (fault === 'immediateTimeout') callback();
        else scenario.engine.dispose();
        return () => undefined;
      };
      const result = await scenario.engine.nativeSignIn(scenario.action);
      scenario.complete(true);
      await drainMethods();
      const saved = scenario.ports.credentials.value;
      scenario.engine.dispose();
      expect(result.kind).toBe(
        fault === 'throw' ? 'apiFailure' : fault === 'dispose' ? 'disposed' : 'expired',
      );
      expect(scenario.counts).toEqual({ provider: 0, passkey: 0 });
      expect(scenario.ports.timer.pending).toBe(0);
      if (fault === 'immediateTimeout') expect(saved).toBeUndefined();
    },
  );

  it.each(['provider', 'passkey'] as const)(
    'starts no %s prompt after setup crosses saved expiry',
    async (kind) => {
      const scenario = await interactiveScenario(kind, 60_000);
      const held = new Deferred<ReturnType<typeof apiReply>>();
      const original = scenario.transport.respond;
      scenario.transport.respond = async (request) => {
        if (request.path.endsWith('/passkey/options')) return held.promise;
        if (!original) throw new Error('Missing transport boundary');
        const response = await original(request);
        if (kind === 'provider' && request.path.includes('/methods'))
          scenario.ports.clock.advance(60_001);
        return response;
      };
      const action = scenario.engine.nativeSignIn(scenario.action);
      await drainMethods();
      if (kind === 'passkey') {
        scenario.ports.clock.advance(60_001);
        held.resolve(apiReply({ challenge: 'challenge-value', rpId: 'example.test' }));
      }
      const result = await action;
      scenario.complete(true);
      await drainMethods();
      const cleared = scenario.ports.credentials.value;
      scenario.engine.dispose();
      expect(result.kind).toBe('expired');
      expect(cleared).toBeUndefined();
      expect(scenario.counts).toEqual({ provider: 0, passkey: 0 });
    },
  );
});
