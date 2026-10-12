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
  const [deadline, setDeadline] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) return;

    const synchronize = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) setDeadline(null);
    };

    const timer = window.setInterval(synchronize, 1000);
    window.addEventListener('focus', synchronize);
    document.addEventListener('visibilitychange', synchronize);
    synchronize();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', synchronize);
      document.removeEventListener('visibilitychange', synchronize);
    };
  }, [deadline]);

  const start = useCallback(
    (durationSeconds = seconds) => {
      const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
      setSecondsLeft(Math.ceil(duration));
      setDeadline(duration > 0 ? Date.now() + duration * 1000 : null);
    },
    [seconds],
  );

  return { secondsLeft, isCooling: secondsLeft > 0, start };
}
