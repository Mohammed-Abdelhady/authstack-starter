import { useCallback, useRef } from 'react';

type FocusEventHandler = (event: Event) => void;

/**
 * For the content of a dialog. A dialog opened through `open` state has no
 * trigger the library knows, so on close the library leaves focus on the page
 * body. This remembers what held focus when the dialog opened and gives the
 * focus back to it on close. It stands aside when the caller's own handler
 * has dealt with the event. A dialog with a trigger the library knows, or an
 * opener that can no longer take focus, ends as the library decides.
 */
export function useOpenerFocus(
  onOpenAutoFocus?: FocusEventHandler,
  onCloseAutoFocus?: FocusEventHandler,
) {
  const opener = useRef<Element | null>(null);

  const rememberOpener = useCallback(
    (event: Event) => {
      opener.current = document.activeElement;
      onOpenAutoFocus?.(event);
    },
    [onOpenAutoFocus],
  );

  const returnToOpener = useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      // The library still runs after this: a trigger it knows gets the focus as
      // before, and a removed or disabled opener leaves the focus to it too.
      if (opener.current instanceof HTMLElement) opener.current.focus();
    },
    [onCloseAutoFocus],
  );

  return { rememberOpener, returnToOpener };
}
