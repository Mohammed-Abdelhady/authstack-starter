import { describe, expect, it } from 'vitest';
import { BROWSER_AUTHORIZATION_TIMEOUT_MS } from '../../src/constants';
import { drainMethods } from './native-methods-fixtures';
import { INTERACTIVE_KIND, interactiveScenario } from './native-interactive-fixtures';

describe('native interactive cancellation and expiry', () => {
  it.each([
    { kind: 'provider' as const, lifetime: 60_000, elapsed: 60_001 },
    { kind: 'passkey' as const, lifetime: 60_000, elapsed: 60_001 },
    {
      kind: 'provider' as const,
      lifetime: 10 * 60_000,
      elapsed: BROWSER_AUTHORIZATION_TIMEOUT_MS + 1,
    },
    {
      kind: 'passkey' as const,
      lifetime: 10 * 60_000,
      elapsed: BROWSER_AUTHORIZATION_TIMEOUT_MS + 1,
    },
    {
      kind: 'mfaPasskey' as const,
      lifetime: 10 * 60_000,
      elapsed: BROWSER_AUTHORIZATION_TIMEOUT_MS + 1,
    },
  ])(
    'rejects late $kind proof at $elapsed when the timer was suspended',
    async ({ kind, lifetime, elapsed }) => {
      const scenario = await interactiveScenario(kind, lifetime);
      const action = scenario.engine.nativeSignIn(scenario.action);
      await scenario.prompted.promise;
      scenario.ports.clock.advance(elapsed);
      scenario.complete(true);
      const result = await action;
      const cleared = scenario.ports.credentials.value;
      scenario.engine.dispose();
      expect(result.kind).toBe('expired');
      expect(cleared).toBeUndefined();
      expect(
        scenario.transport.sent.some(
          ({ path }) =>
            path.endsWith('/provider') ||
            path.endsWith('/passkey/verify') ||
            path.endsWith('/second-factor'),
        ),
      ).toBe(false);
      expect(scenario.ports.timer.pending).toBe(0);
    },
  );

  it.each(INTERACTIVE_KIND)(
    'settles cancelled %s while retaining its physical prompt lease',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      const { engine, ports, transport } = scenario;
      let early: string | undefined;
      const action = engine.nativeSignIn(scenario.action).then((result) => {
        early = result.kind;
        return result;
      });
      await scenario.prompted.promise;
      await engine.cancelNativeSignIn();
      await drainMethods();
      const earlyKind = early;
      await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
      const retry = engine.nativeSignIn(scenario.action);
      await drainMethods();
      const countsBeforePhysical = { ...scenario.counts };
      scenario.complete(true);
      const [result, retried] = await Promise.all([action, retry]);
      await drainMethods();
      const artifactCount = transport.sent.filter(
        ({ path }) =>
          path.endsWith('/provider') ||
          path.endsWith('/passkey/verify') ||
          path.endsWith('/second-factor'),
      ).length;
      engine.dispose();
      expect(earlyKind).toBe('signedOut');
      expect(result.kind).toBe('signedOut');
      expect(retried.kind).toBe('unavailable');
      expect(countsBeforePhysical).toEqual(
        kind === 'provider' ? { provider: 1, passkey: 0 } : { provider: 0, passkey: 1 },
      );
      expect(artifactCount).toBe(0);
      expect(ports.authBrowser.opened).toHaveLength(0);
      expect(ports.timer.pending).toBe(0);
    },
  );

  it.each(INTERACTIVE_KIND)('settles disposed %s and discards its late artifact', async (kind) => {
    const scenario = await interactiveScenario(kind);
    const { engine, ports, transport } = scenario;
    let early: string | undefined;
    const action = engine.nativeSignIn(scenario.action).then((result) => {
      early = result.kind;
      return result;
    });
    await scenario.prompted.promise;
    engine.dispose();
    await drainMethods();
    const earlyKind = early;
    scenario.complete(true);
    await action;
    await drainMethods();
    expect(earlyKind).toBe('disposed');
    expect(
      transport.sent.some(
        ({ path }) =>
          path.endsWith('/provider') ||
          path.endsWith('/passkey/verify') ||
          path.endsWith('/second-factor'),
      ),
    ).toBe(false);
    expect(ports.timer.pending).toBe(0);
  });

  it.each([
    { kind: 'provider' as const, lifetime: 60_000, limit: 60_000 },
    { kind: 'passkey' as const, lifetime: 60_000, limit: 60_000 },
    { kind: 'provider' as const, lifetime: 10 * 60_000, limit: BROWSER_AUTHORIZATION_TIMEOUT_MS },
    { kind: 'passkey' as const, lifetime: 10 * 60_000, limit: BROWSER_AUTHORIZATION_TIMEOUT_MS },
  ])('expires $kind at the smaller flow/server limit $limit', async ({ kind, lifetime, limit }) => {
    const scenario = await interactiveScenario(kind, lifetime);
    const { engine, ports, transport } = scenario;
    let early: string | undefined;
    const action = engine.nativeSignIn(scenario.action).then((result) => {
      early = result.kind;
      return result;
    });
    await scenario.prompted.promise;
    ports.clock.advance(limit);
    ports.timer.fireDelay(limit);
    await drainMethods();
    const expired = early;
    const cleared = ports.credentials.value;
    scenario.complete(true);
    await action;
    await drainMethods();
    engine.dispose();
    expect(expired).toBe('expired');
    expect(cleared).toBeUndefined();
    expect(
      transport.sent.some(
        ({ path }) =>
          path.endsWith('/provider') ||
          path.endsWith('/passkey/verify') ||
          path.endsWith('/second-factor'),
      ),
    ).toBe(false);
    expect(ports.timer.pending).toBe(0);
  });
});
