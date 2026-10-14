import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';
import { isHeld } from './busyControls';

/**
 * Whether an element is drawn. A hidden part of a page stays in the document,
 * open dialogs included, with `display: none` on it or on what holds it.
 */
export function isOnScreen(element: Element | null): boolean {
  if (element === null || !element.isConnected) return false;
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

/** Whether the dialog with this test id is open and drawn. */
export function isOpen(dialogId: string): boolean {
  const dialog = screen.queryByTestId(dialogId);
  return dialog?.getAttribute('data-state') === 'open' && isOnScreen(dialog);
}

/**
 * Asks a dialog to close every way a person can without its own buttons:
 * Escape, a press outside it, and its close control where it has one.
 */
export async function askToClose(dialogId: string) {
  const dialog = screen.getByTestId(dialogId);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.pointerDown(document.body);
  const closeControl = within(dialog).queryByTestId('dialog-close-button');
  if (closeControl) fireEvent.click(closeControl);
  // The library closes after the event, not inside it.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

interface InFlightDialog {
  /** Test id of the dialog content. */
  dialogId: string;
  /** Test id of its own Cancel button, where it has one. */
  cancelId?: string;
  /** Every close the dialog asked its owner for so far, as `onOpenChange` or `onClose` calls. */
  closes: () => number;
  /** Ends the request with a refusal. */
  refuse: () => void;
  /** A control of the dialog that is held while the request runs. */
  heldControl: () => HTMLElement;
}

/**
 * For a dialog whose request was just sent and is held open by the test: it
 * asks for no close by Escape, a press outside, its close control or Cancel
 * until the request settles, and closes by any of them afterwards.
 */
export async function expectClosableOnlyOnceSettled({
  dialogId,
  cancelId,
  closes,
  refuse,
  heldControl,
}: InFlightDialog) {
  await waitFor(() => expect(isHeld(heldControl())).toBe(true));
  const guard = closeGuard(dialogId, cancelId);
  await waitFor(() => expect(isHeld(guard)).toBe(true));
  const before = closes();

  await askToClose(dialogId);
  if (cancelId) fireEvent.click(screen.getByTestId(cancelId));
  await askToClose(dialogId);
  expect(closes()).toBe(before);
  expect(isOpen(dialogId)).toBe(true);

  refuse();
  await waitFor(() => expect(isHeld(heldControl())).toBe(false));
  // The dialog's guard can clear a render after the control that sent the request.
  await waitFor(() => expect(isHeld(guard)).toBe(false));
  expect(isOpen(dialogId)).toBe(true);
  fireEvent.keyDown(screen.getByTestId(dialogId), { key: 'Escape' });

  await waitFor(() => expect(closes()).toBe(before + 1));
}

/**
 * The dialog's own close control, or its Cancel where it has none. Either one
 * reads the dialog's busy state in the same render as its Escape guard.
 */
function closeGuard(dialogId: string, cancelId: string | undefined): HTMLElement {
  const closeControl = within(screen.getByTestId(dialogId)).queryByTestId('dialog-close-button');
  if (closeControl) return closeControl;
  if (cancelId) return screen.getByTestId(cancelId);
  throw new Error(`${dialogId} has no close control; pass its cancelId`);
}
