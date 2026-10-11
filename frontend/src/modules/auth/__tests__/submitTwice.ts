import { act } from '@testing-library/react';

/**
 * Two submissions before React can render between them, which is what a
 * script or a control that fires twice does and what a disabled button
 * cannot stop.
 */
export function submitTwiceInOneTick(form: HTMLElement): void {
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('submitTwiceInOneTick needs a form element');
  }
  act(() => {
    form.requestSubmit();
    form.requestSubmit();
  });
}

/** Two activations of one control before React can render between them. */
export function clickTwiceInOneTick(control: HTMLElement): void {
  act(() => {
    control.click();
    control.click();
  });
}

/** The writes among recorded `METHOD /path` requests, in arrival order. */
export function writesOf(requests: readonly string[]): string[] {
  return requests.filter((request) => !request.startsWith('GET '));
}
