import type { MouseEvent } from 'react';

/**
 * What a control carries while a request it belongs to runs. It stays
 * focusable, so focus does not fall to the page body the way it does from a
 * control with the native `disabled` attribute, and it says it is unavailable.
 * The control that started the request also sets `aria-busy` where it is used.
 */
export const HELD_ATTRIBUTES = { 'aria-disabled': true } as const;

/**
 * How a busy button, checkbox or link-like control looks. It is waiting, not
 * disabled: its label must stay readable, so the whole control is toned down
 * only as far as its text keeps 4.5:1. The contrast gate reads this opacity.
 * It takes the press itself: with `pointer-events: none` a click would land on
 * whatever is behind it and move the focus there.
 */
export const BUSY_PRESS_CLASSES = 'aria-disabled:cursor-progress aria-disabled:opacity-85';

/**
 * How a busy text field or select looks. What was typed stays readable in the
 * muted text colour, and the border keeps its full strength: it has no
 * contrast to spare. The contrast gate reads this colour.
 */
export const BUSY_FIELD_CLASSES =
  'aria-disabled:cursor-progress aria-disabled:text-muted-foreground';

/**
 * For a control that says `aria-disabled` because it is blocked, not busy: it
 * stays focusable so its reason is read, and looks unavailable.
 */
export const BLOCKED_PRESS_CLASSES = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

function ignorePress(event: MouseEvent) {
  // Cancelling the click also stops a submit button from sending its form and
  // a library control from acting on it. It goes no further: the control is
  // the one that was pressed, and nothing around it should act on it either.
  event.preventDefault();
  event.stopPropagation();
}

/** Props for a pressable control: while busy, a press does nothing. */
export function busyPressProps<T>(busy: boolean | undefined, onClick: T) {
  return busy ? { ...HELD_ATTRIBUTES, onClick: ignorePress } : { onClick };
}

/** Props for a text field: while busy, its value cannot be edited. */
export function busyFieldProps(busy: boolean | undefined, readOnly: boolean | undefined) {
  return busy ? { ...HELD_ATTRIBUTES, readOnly: true } : { readOnly };
}
