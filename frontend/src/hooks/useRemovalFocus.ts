import { useCallback, useRef, type RefObject } from 'react';

/**
 * For a dialog that confirms a removal. Once the thing is gone, the control
 * that opened the dialog is gone with it, or stands for its neighbour, which
 * would put the next keystroke on a removal nobody asked for. Focus goes to
 * `landing` instead: the heading of the list or section the thing was removed
 * from, given `tabIndex={-1}`.
 *
 * Call `noteRemoved` when the removal succeeded, before closing the dialog,
 * and hand `focusLanding` to the dialog content as `onCloseAutoFocus`. A
 * dialog closed any other way returns focus to its opener as usual.
 */
export function useRemovalFocus(landing: RemovalLanding | undefined) {
  const removed = useRef(false);
  // Read once: a caller passes one ref for as long as it lives.
  const target = useRef(landing);

  const noteRemoved = useCallback(() => {
    removed.current = true;
  }, []);

  const focusLanding = useCallback((event: Event) => {
    if (!removed.current) return;
    removed.current = false;
    event.preventDefault();
    target.current?.current?.focus();
  }, []);

  return { noteRemoved, focusLanding };
}

/** The ref of a heading that takes focus after a removal. */
export type RemovalLanding = RefObject<HTMLElement | null>;
