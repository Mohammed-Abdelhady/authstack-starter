import { useCallback, useEffect, useRef, type RefObject } from 'react';

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

/**
 * For a Retry that leaves the page once the read it retries succeeds. Returns
 * the retry to call from the button. When the failure is over, focus goes to
 * `landing`: the heading or first control of what the failure stood in for.
 */
export function useRetryHandOff(
  hasFailed: boolean,
  retry: () => unknown,
  landing: RefObject<HTMLElement | null>,
) {
  const { arm, handTo } = useFocusHandOff();

  useEffect(() => {
    if (!hasFailed) handTo(landing.current);
  }, [hasFailed, handTo, landing]);

  return useCallback(() => {
    arm();
    void retry();
  }, [arm, retry]);
}
