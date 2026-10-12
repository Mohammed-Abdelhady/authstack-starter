import { expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

/**
 * Focuses a button and presses it, waits for the dialog it opens to take
 * focus, closes the dialog with Escape, and returns the test id of whatever
 * holds focus once it has left the dialog.
 */
export async function focusAfterOpenAndEscape(
  openerId: string,
  dialogId: string,
): Promise<string | null> {
  const opener = await screen.findByTestId(openerId);
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByTestId(dialogId);
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

  fireEvent.keyDown(dialog, { key: 'Escape' });

  // A page may keep a closed dialog in the document, hidden, so this waits for
  // the focus to leave it and not for the dialog to go.
  await waitFor(() => {
    const focused = document.activeElement;
    expect(focused === document.body || dialog.contains(focused)).toBe(false);
  });
  return document.activeElement?.getAttribute('data-testid') ?? null;
}
