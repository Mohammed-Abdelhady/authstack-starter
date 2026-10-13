import { describe, expect, it } from 'vitest';
import { Deferred, apiReply } from '../support/support';
import { drainMethods, GOOGLE_METHODS } from './native-methods-fixtures';
import { NETWORK_TIMEOUT_MS, interactiveScenario } from './native-interactive-fixtures';

describe('native passkey setup lifetime', () => {
  it.each(['passkey', 'mfaPasskey'] as const)(
    'bounds physical readiness waiters across timed-out %s retries',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      const held = new Deferred<boolean>();
      let reads = 0;
      let ready = false;
      scenario.availability.passkey = () => {
        reads += 1;
        return ready ? Promise.resolve(true) : held.promise;
      };
      try {
        for (let retry = 0; retry < 8; retry += 1) {
          const action = scenario.engine.nativeSignIn(scenario.action);
          await drainMethods();
          scenario.ports.timer.fireDelay(NETWORK_TIMEOUT_MS);
          expect.soft((await action).kind).toBe('apiFailure');
        }
        expect.soft(reads).toBe(1);
        expect
          .soft(scenario.transport.sent.filter(({ path }) => path.includes('/methods')))
          .toHaveLength(1);
        expect
          .soft(scenario.transport.sent.some(({ path }) => path.endsWith('/passkey/options')))
          .toBe(false);
        expect.soft(scenario.counts.passkey).toBe(0);
        expect.soft(scenario.ports.timer.pending).toBe(0);
        ready = true;
        held.resolve(true);
        await drainMethods();
        const fresh = scenario.engine.nativeSignIn(scenario.action);
        await drainMethods();
        scenario.complete(false);
        expect.soft((await fresh).kind).toBe('cancelled');
        expect.soft(reads).toBe(2);
        expect
          .soft(scenario.transport.sent.filter(({ path }) => path.includes('/methods')))
          .toHaveLength(2);
        expect.soft(scenario.counts.passkey).toBe(1);
      } finally {
        held.resolve(false);
        scenario.complete(false);
        scenario.engine.dispose();
      }
    },
  );

  it.each(['passkey', 'mfaPasskey'] as const)(
    'checks server capability before direct %s options or a prompt',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      const previous = scenario.transport.respond;
      if (!previous) throw new Error('Interactive transport has no response boundary');
      scenario.transport.respond = async (request) =>
        request.path.includes('/methods')
          ? apiReply({
              ...GOOGLE_METHODS,
              capabilities: { ...GOOGLE_METHODS.capabilities, passkeys: false },
            })
          : previous(request);
      try {
        const action = scenario.engine.nativeSignIn(scenario.action);
        await drainMethods();
        // Release an unexpected prompt so this assertion fails without hanging.
        scenario.complete(false);
        expect.soft((await action).kind).toBe('unavailable');
        expect
          .soft(scenario.transport.sent.some(({ path }) => path.endsWith('/passkey/options')))
          .toBe(false);
        expect.soft(scenario.counts.passkey).toBe(0);
      } finally {
        scenario.complete(false);
        scenario.engine.dispose();
      }
    },
  );
});
