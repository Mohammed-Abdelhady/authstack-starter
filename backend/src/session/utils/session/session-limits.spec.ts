import { sessionLimitsFor } from './session-limits';

const POLICY = { absoluteLifetimeMs: 3_600_000, idleLifetimeMs: 900_000 };
const CONFIGURED = {
  ...POLICY,
  unboundAbsoluteLifetimeMs: 600_000,
  unboundIdleLifetimeMs: 60_000,
};

describe('session limit selection', () => {
  // Failure: default native sessions lose their short initial idle window.
  it.each([true, false])(
    'preserves absent native limits with bound=%s',
    (bound) => {
      expect(
        sessionLimitsFor({ policy: POLICY, platform: 'native' }, bound),
      ).toEqual({
        absoluteLifetimeMs: 3_600_000,
        idleLifetimeMs: 900_000,
        initialIdleLifetimeMs: 300_000,
      });
    },
  );

  // Failure: configured native limits remove the initial idle ceiling.
  it.each([
    { bound: true, absolute: 3_600_000, idle: 900_000, initial: 300_000 },
    { bound: false, absolute: 600_000, idle: 60_000, initial: 60_000 },
  ])(
    'selects configured native limits with bound=$bound',
    ({ bound, absolute, idle, initial }) => {
      expect(
        sessionLimitsFor({ platform: 'native', policy: CONFIGURED }, bound),
      ).toEqual({
        absoluteLifetimeMs: absolute,
        idleLifetimeMs: idle,
        initialIdleLifetimeMs: initial,
      });
    },
  );

  it.each([60_000, 300_000])(
    'never extends a native idle policy of %s at first issuance',
    (idle) => {
      expect(
        sessionLimitsFor(
          { platform: 'native', policy: { ...POLICY, idleLifetimeMs: idle } },
          false,
        ).initialIdleLifetimeMs,
      ).toBe(idle);
    },
  );

  // Failure: browser sessions inherit the native five-minute initial idle.
  it('uses a browser idle policy from its first issuance', () => {
    expect(
      sessionLimitsFor({ platform: 'web', policy: POLICY }, false),
    ).toEqual({
      absoluteLifetimeMs: 3_600_000,
      idleLifetimeMs: 900_000,
      initialIdleLifetimeMs: 900_000,
    });
  });
});
