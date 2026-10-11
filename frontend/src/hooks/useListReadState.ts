import { useCallback, useEffect, type RefObject } from 'react';
import { useFocusHandOff } from './useFocusHandOff';

interface ListRead {
  isLoading: boolean;
  isError: boolean;
  /** Whether the list for this view was read at least once. */
  hasData: boolean;
  refetch: () => unknown;
  /** The heading that takes focus when Retry leaves with its failure. */
  landing: RefObject<HTMLElement | null>;
}

/**
 * How a list page shows a failed read. A first load that failed replaces the
 * list. A later read that failed leaves the list, and whatever is open over
 * it, on screen with a notice above it.
 */
export function useListReadState({ isLoading, isError, hasData, refetch, landing }: ListRead) {
  const { arm, handTo } = useFocusHandOff();

  const retry = useCallback(() => {
    arm();
    void refetch();
  }, [arm, refetch]);

  useEffect(() => {
    if (!isError) handTo(landing.current);
  }, [isError, handTo, landing]);

  return {
    showLoadError: !isLoading && isError && !hasData,
    isStale: isError && hasData,
    retry,
  };
}
