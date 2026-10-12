import type { RefObject } from 'react';
import { useRetryHandOff } from './useFocusHandOff';

interface ListRead {
  isLoading: boolean;
  /** What the last read failed with. The store keeps it until a read succeeds. */
  error: unknown;
  /** Whether the list for this view was read at least once. */
  hasData: boolean;
  refetch: () => unknown;
  /** The heading that takes focus when Retry leaves with its failure. */
  landing: RefObject<HTMLElement | null>;
}

/**
 * How a list page shows a failed read. A first load that failed replaces the
 * list. A later read that failed leaves the list, and whatever is open over
 * it, on screen with a notice above it. Either stays while a retry runs, so
 * Retry keeps the focus until the failure is over.
 */
export function useListReadState({ isLoading, error, hasData, refetch, landing }: ListRead) {
  const hasFailed = error !== undefined;
  const retry = useRetryHandOff(hasFailed, refetch, landing);

  return {
    showSkeleton: isLoading && !hasFailed,
    showLoadError: hasFailed && !hasData,
    isStale: hasFailed && hasData,
    retry,
  };
}
