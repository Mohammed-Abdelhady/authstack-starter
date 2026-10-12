'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Cooldown {
  /** Seconds left, zero when the action is available again. */
  secondsLeft: number;
  isCooling: boolean;
  start: (durationSeconds?: number) => void;
}

/**
 * Counts a resend cooldown down to zero, one second at a time. Used by the
 * activation code and the magic link, which both cap how often they remail.
 */
export function useCooldown(seconds: number): Cooldown {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const start = useCallback(
    (durationSeconds = seconds) => setSecondsLeft(durationSeconds),
    [seconds],
  );

  return { secondsLeft, isCooling: secondsLeft > 0, start };
}
