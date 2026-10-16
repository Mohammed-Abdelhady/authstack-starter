import { mailedCodeMinutes } from './email-code-minutes';

const TEN_MINUTES = 600_000;

describe('minutes a sign-in code mail states', () => {
  it.each([
    ['the full default lifetime', TEN_MINUTES, TEN_MINUTES, 10],
    [
      'a lifetime cut short by the attempt, rounded up',
      150_001,
      TEN_MINUTES,
      3,
    ],
    ['seconds left, never zero', 30_000, TEN_MINUTES, 1],
    ['one millisecond left', 1, TEN_MINUTES, 1],
    ['a configured lifetime between whole minutes', 90_000, 90_000, 1],
  ])('states %s', (_case, remainingMs, configuredMs, minutes) => {
    expect(mailedCodeMinutes(remainingMs, configuredMs)).toBe(minutes);
  });
});
