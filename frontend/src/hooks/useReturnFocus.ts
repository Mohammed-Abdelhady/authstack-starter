import { useCallback, useRef } from 'react';

/**
 * For a dialog that a menu entry or a list option opened. Such a dialog has no
 * trigger of its own, so the library would leave focus on the page body when
 * it closes. Returns a ref for the control the person started from, and the
 * close handler that sends focus back to it.
 */
export function useReturnFocus<T extends HTMLElement = HTMLElement>() {
  const opener = useRef<T | null>(null);
  const returnFocus = useCallback(() => {
    opener.current?.focus();
  }, []);
  return [opener, returnFocus] as const;
}
