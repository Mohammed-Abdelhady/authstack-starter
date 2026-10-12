import { describe, expect, it } from 'vitest';
import { Deferred, apiReply } from '../support/support';
import { secondFactorReply } from './native-fixtures';
import { drainMethods } from './native-methods-fixtures';
import {
  INTERACTIVE_KIND,
  NETWORK_TIMEOUT_MS,
  interactiveScenario,
} from './native-interactive-fixtures';

describe('native interactive network phases', () => {
  it.each(['provider', 'passkey'] as const)(
    'bounds stalled %s SDK readiness before a prompt',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      const held = new Deferred<boolean>();
      scenario.availability[kind] = () => held.promise;
      let early: string | undefined;
      const action = scenario.engine.nativeSignIn(scenario.action).then((result) => {
        early = result.kind;
        return result;
      });
      await drainMethods();
      scenario.ports.timer.fireDelay(NETWORK_TIMEOUT_MS);
      await drainMethods();
      const earlyFailure = early;
      held.resolve(true);
      await action;
      scenario.complete(false);
      await drainMethods();
      scenario.engine.dispose();
      expect(earlyFailure).toBe('apiFailure');
      expect(scenario.counts).toEqual({ provider: 0, passkey: 0 });
      expect(scenario.ports.timer.pending).toBe(0);
    },
  );

  it.each(INTERACTIVE_KIND)(
    'gives %s proof HTTP its own bounded deadline after a long prompt',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      const { engine, ports, transport } = scenario;
      let early: string | undefined;
      const action = engine.nativeSignIn(scenario.action).then((result) => {
        early = result.kind;
        return result;
      });
      await scenario.prompted.promise;
      ports.clock.advance(NETWORK_TIMEOUT_MS + 1);
      ports.timer.fireDelay(NETWORK_TIMEOUT_MS);
      await drainMethods();
      const held = new Deferred<ReturnType<typeof apiReply>>();
      transport.respond = () => held.promise;
      scenario.complete(true);
      await drainMethods();
      const proof = transport.sent.at(-1);
      const bounded = ports.timer.pendingDelays.includes(NETWORK_TIMEOUT_MS);
      ports.timer.fireDelay(NETWORK_TIMEOUT_MS);
      await drainMethods();
      const earlyFailure = early;
      const aborted = proof?.signal?.aborted;
      held.resolve(secondFactorReply(scenario.expiresAt));
      await action;
      await drainMethods();
      engine.dispose();
      expect(bounded).toBe(true);
      expect(earlyFailure).toBe('apiFailure');
      expect(aborted).toBe(true);
      expect(proof?.path).toBe(
        kind === 'provider'
          ? '/api/auth/native/attempts/attempt-1/provider'
          : kind === 'mfaPasskey'
            ? '/api/auth/native/attempts/attempt-1/second-factor'
            : '/api/auth/native/attempts/attempt-1/passkey/verify',
      );
      expect(ports.timer.pending).toBe(0);
    },
  );

  it.each(['provider', 'passkey'] as const)(
    'bounds %s setup HTTP before opening a prompt',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      const { engine, ports, transport } = scenario;
      const held = new Deferred<ReturnType<typeof apiReply>>();
      transport.respond = () => held.promise;
      let early: string | undefined;
      const action = engine.nativeSignIn(scenario.action).then((result) => {
        early = result.kind;
        return result;
      });
      await drainMethods();
      const request = transport.sent.at(-1);
      ports.timer.fireDelay(NETWORK_TIMEOUT_MS);
      await drainMethods();
      const earlyFailure = early;
      held.resolve(apiReply(null));
      await action;
      scenario.complete(false);
      await drainMethods();
      engine.dispose();
      expect(earlyFailure).toBe('apiFailure');
      expect(request?.signal?.aborted).toBe(true);
      expect(scenario.counts).toEqual({ provider: 0, passkey: 0 });
      expect(ports.timer.pending).toBe(0);
    },
  );
});
