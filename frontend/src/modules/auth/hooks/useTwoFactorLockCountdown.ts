'use client';

import { useCallback } from 'react';
import { useCooldown } from './useCooldown';
import { twoFactorLockSeconds } from '../utils/twoFactorLock';

/** Runs a visible countdown only for a server lock with a valid retryAfter. */
export function useTwoFactorLockCountdown() {
  const { secondsLeft, isCooling, start } = useCooldown(0);
  const startForError = useCallback(
    (error: unknown) => {
      const seconds = twoFactorLockSeconds(error);
      if (seconds === null) return false;
      start(seconds);
      return true;
    },
    [start],
  );
  return { secondsLeft, isCooling, start, startForError };
}
