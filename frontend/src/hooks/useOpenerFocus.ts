import { useCallback, useEffect, useRef, type ForwardedRef } from 'react';

type FocusEventHandler = (event: Event) => void;

const RECENT_LIMIT = 8;
/** What held focus lately, oldest first. `null` stands for nothing at all. */
const recent: (Element | null)[] = [];
let watchers = 0;

function note(entry: Element | null) {
  if (recent.at(-1) === entry) return;
  recent.push(entry);
  if (recent.length > RECENT_LIMIT) recent.shift();
}

function noteFocusIn(event: FocusEvent) {
  if (event.target instanceof Element) note(event.target);
}

function noteFocusOut(event: FocusEvent) {
  if (event.relatedTarget === null) note(null);
}

/** One pair of listeners for every dialog on the page, removed with the last of them. */
function watchFocus() {
  if (watchers === 0) {
    document.addEventListener('focusin', noteFocusIn, true);
    document.addEventListener('focusout', noteFocusOut, true);
  }
  watchers += 1;
  return () => {
    watchers -= 1;
    if (watchers > 0) return;
    document.removeEventListener('focusin', noteFocusIn, true);
    document.removeEventListener('focusout', noteFocusOut, true);
    recent.length = 0;
  };
}

/**
 * The last thing that held focus outside `content`. A field inside a dialog
 * can take focus as it mounts, so what holds focus when the dialog opens is
 * not always what opened it.
 */
function focusOutside(content: Node, earlier: Element | null): Element | null {
  const lately = [document.activeElement, ...[...recent].reverse()];
  const seen = lately.find((entry) => entry === null || !content.contains(entry));
  return seen === undefined ? earlier : seen;
}

function handToRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

/**
 * For the content of a dialog. A dialog opened through `open` state has no
 * trigger the library knows, so on close the library leaves focus on the page
 * body. This remembers what held focus outside the dialog as its content
 * joined the page and gives the focus back to it on close. It stands aside
 * when the caller's own handler has dealt with the event. A dialog with a
 * trigger the library knows, or an opener that can no longer take focus, ends
 * as the library decides.
 */
export function useOpenerFocus<T extends HTMLElement>(
  forwardedRef: ForwardedRef<T>,
  onCloseAutoFocus?: FocusEventHandler,
) {
  const opener = useRef<Element | null>(null);
  // What held focus before the listeners were there to see it arrive. This
  // runs before the content mounts, a dialog that starts open included.
  const focusedBefore = useRef<Element | null>(null);

  useEffect(() => {
    focusedBefore.current = document.activeElement;
    return watchFocus();
  }, []);

  // The library reports an opening only when nothing inside holds focus yet,
  // so the opener is read as the content mounts, not from that report.
  const contentRef = useCallback(
    (content: T | null) => {
      handToRef(forwardedRef, content);
      if (content === null) return;
      opener.current = focusOutside(content, focusedBefore.current);
    },
    [forwardedRef],
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

  return { contentRef, returnToOpener };
}
