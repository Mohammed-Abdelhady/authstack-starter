import { expect } from 'vitest';
import { waitFor } from '@testing-library/react';

/**
 * jsdom leaves focus on a control that becomes disabled. A browser moves it to
 * the page body, which is how a form that disables its own controls while its
 * request runs loses the person's place. This gives jsdom the browser's rule.
 * Returns the function that stops it.
 */
export function loseFocusWhenDisabled(): () => void {
  const observer = new MutationObserver(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches(':disabled')) focused.blur();
  });
  observer.observe(document, { attributes: true, attributeFilter: ['disabled'], subtree: true });
  return () => observer.disconnect();
}

/**
 * How a control is unavailable. One whose own request is running must be
 * `HELD`: said to be unavailable and still able to hold focus. One that is
 * `IDLE` can be used.
 */
export function availability(control: Element) {
  return {
    saysUnavailable: control.getAttribute('aria-disabled') === 'true',
    canHoldFocus: !control.matches(':disabled'),
  };
}

/** Whether a control is waiting for a request to end. */
export const isHeld = (control: Element) => control.getAttribute('aria-disabled') === 'true';

export const HELD = { saysUnavailable: true, canHoldFocus: true } as const;
export const IDLE = { saysUnavailable: false, canHoldFocus: true } as const;

/** An answer a test gives later, so it can look at the page while the request runs. */
export function heldAnswer() {
  let settle: (respond: () => Response) => void = () => undefined;
  const answer = new Promise<Response>((resolve, reject) => {
    settle = (respond) => {
      try {
        resolve(respond());
      } catch (error) {
        reject(error);
      }
    };
  });
  return { answer, settle };
}

/** What `fetch` does when the server cannot be reached. */
export function unreachable(): Response {
  throw new TypeError('Failed to fetch');
}

/**
 * For a control that holds focus when a request starts: it is held with the
 * focus still on it while the request runs, and has the focus, idle, after
 * `settle` ended the request.
 */
export async function expectFocusKeptThroughRequest(control: HTMLElement, settle: () => void) {
  await waitFor(() => expect(availability(control)).toEqual(HELD));
  // A move of focus to the page body would follow the change that held it.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(control);

  settle();

  await waitFor(() => expect(availability(control)).toEqual(IDLE));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(control);
}
