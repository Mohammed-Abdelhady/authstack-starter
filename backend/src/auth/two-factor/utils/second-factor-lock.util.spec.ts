import { lockDurationMs, retryAfterSeconds } from './second-factor-lock.util';

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

  it('does not lock on a count below zero', () => {
    expect(lockDurationMs(-5)).toBe(0);
  });
});

describe('the seconds a locked account is told to wait', () => {
  const now = Date.UTC(2099, 0, 1, 12, 0, 0);

  it.each([
    [60_000, 60],
    [59_001, 60],
    [59_000, 59],
    [1, 1],
    [1_000, 1],
    [1_001, 2],
  ])('rounds %i ms left up to %i s', (leftMs, seconds) => {
    expect(retryAfterSeconds(new Date(now + leftMs), now)).toBe(seconds);
  });

  it('never says less than a second', () => {
    expect(retryAfterSeconds(new Date(now), now)).toBe(1);
  });
});
