import type { MouseEvent } from 'react';

/**
 * What a control carries while a request it belongs to runs. It stays
 * focusable, so focus does not fall to the page body the way it does from a
 * control with the native `disabled` attribute, and it says it is unavailable.
 * The control that started the request also sets `aria-busy` where it is used.
 */
export const HELD_ATTRIBUTES = { 'aria-disabled': true } as const;

function ignorePress(event: MouseEvent) {
  // Cancelling the click also stops a submit button from sending its form and
  // a library control from acting on it.
  event.preventDefault();
}

/** Props for a pressable control: while busy, a press does nothing. */
export function busyPressProps<T>(busy: boolean | undefined, onClick: T) {
  return busy ? { ...HELD_ATTRIBUTES, onClick: ignorePress } : { onClick };
}

/** Props for a text field: while busy, its value cannot be edited. */
export function busyFieldProps(busy: boolean | undefined, readOnly: boolean | undefined) {
  return busy ? { ...HELD_ATTRIBUTES, readOnly: true } : { readOnly };
}
