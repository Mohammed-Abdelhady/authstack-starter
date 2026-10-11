import { useCallback, useRef } from 'react';

/**
 * For a control that is replaced by what it brings about: a Retry that leaves
 * with its error, a form that gives way to a confirmation. A browser drops the
 * focus of a removed or hidden control on the page body. Call `arm` as the
 * control is used, and `handTo` with the heading or first field of the new
 * content once it is on the page. Focus moves only if it is still on that
 * control, or already lost: a person who moved on is left alone.
 */
export function useFocusHandOff() {
  const armed = useRef<Element | null>(null);
  const isArmed = useRef(false);

  const arm = useCallback(() => {
    armed.current = document.activeElement;
    isArmed.current = true;
  }, []);

  const handTo = useCallback((target: HTMLElement | null | undefined) => {
    if (!isArmed.current || !target) return;
    isArmed.current = false;
    const active = document.activeElement;
    const stillThere = active !== null && active === armed.current;
    const lost = active === null || active === document.body;
    armed.current = null;
    if (stillThere || lost) target.focus();
  }, []);

  return { arm, handTo };
}
