import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/** The keys that choose an option and also press a button. */
const ACTIVATION_KEYS: ReadonlySet<string> = new Set(['Enter', ' ']);
const GUARDED_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

/**
 * Swallows every further event of `key` until the key comes up. A keydown of
 * the same key before its keyup is a repeat, whether or not the keyboard says
 * so. The window losing focus ends it too, because the keyup may then go
 * somewhere this page cannot see. Returns the function that ends the guard early.
 */
function swallowUntilReleased(key: string): () => void {
  const stop = () => {
    for (const type of GUARDED_EVENTS) document.removeEventListener(type, swallow, true);
    window.removeEventListener('blur', stop);
  };
  function swallow(event: KeyboardEvent) {
    if (event.key !== key) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'keyup') stop();
  }
  for (const type of GUARDED_EVENTS) document.addEventListener(type, swallow, true);
  window.addEventListener('blur', stop);
  return stop;
}

/**
 * For a list whose options open something when chosen. One keystroke is a
 * keydown, a keypress and a keyup, and the later parts go to whatever holds
 * focus by then, so the key that chose an option would also press a button
 * that took focus meanwhile. Put the returned handler on the list as
 * `onKeyDownCapture`: the rest of that keystroke, repeats of a held key
 * included, then reaches nothing.
 */
export function useKeyReleaseGuard() {
  const stopGuard = useRef<(() => void) | null>(null);

  useEffect(() => () => stopGuard.current?.(), []);

  return useCallback((event: ReactKeyboardEvent) => {
    if (!ACTIVATION_KEYS.has(event.key)) return;
    stopGuard.current?.();
    stopGuard.current = swallowUntilReleased(event.key);
  }, []);
}
