'use client';

import { useCallback, useRef } from 'react';

/**
 * Wraps an async action so a call made while an earlier one is still pending
 * does nothing and resolves to `undefined`.
 *
 * A disabled button only stops a second submission after a render. This holds
 * from the first line of the first call, and lets go when that call settles,
 * whether it resolved or threw. It keeps a ref and no state, so an action that
 * settles after the component has gone updates nothing.
 */
export function useSingleFlight<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result> | Result,
): (...args: Args) => Promise<Result | undefined> {
  const inFlight = useRef(false);

  return useCallback(
    async (...args: Args) => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      try {
        return await action(...args);
      } finally {
        inFlight.current = false;
      }
    },
    [action],
  );
}

type Task = () => Promise<void>;

const runTask = (task: Task): Promise<void> => task();

/**
 * One gate for several actions that must not overlap each other, such as a
 * submit and a resend on the same form. Whatever is handed to the returned
 * function is dropped while another task is pending.
 */
export function useSharedSingleFlight(): (task: Task) => Promise<void> {
  return useSingleFlight(runTask);
}
