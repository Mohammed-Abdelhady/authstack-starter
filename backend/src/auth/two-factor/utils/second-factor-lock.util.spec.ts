import { lockDurationMs } from './second-factor-lock.util';

describe('how long wrong second factor answers lock an account', () => {
  it.each([0, 1, 4, 6, 9, 11, 14, 101])(
    'does not lock at %i wrong answers',
    (failedAttempts) => {
      expect(lockDurationMs(failedAttempts)).toBe(0);
    },
  );

  it.each([
    [5, 60_000],
    [10, 120_000],
    [15, 240_000],
    [20, 480_000],
    [25, 960_000],
    [30, 1_920_000],
    [35, 3_600_000],
    [40, 3_600_000],
    [5_000, 3_600_000],
  ])('locks for %i wrong answers: %i ms', (failedAttempts, lockMs) => {
    expect(lockDurationMs(failedAttempts)).toBe(lockMs);
  });
});
