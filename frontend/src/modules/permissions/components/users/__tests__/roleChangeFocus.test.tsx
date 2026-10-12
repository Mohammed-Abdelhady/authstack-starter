// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { registerFormTestLifecycle } from '@/tests/serverRejectionHarness';
import { availability, HELD } from '@/tests/busyControls';
import { pressKey } from './keystroke';
import {
  CONFIRM_DIALOG,
  focusAfterClose,
  focusEditorOption,
  settledConfirmation,
  stubListLayout,
} from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const SELECTOR = 'user-role-selector-user-2';

/** Chooses "Editor" by keyboard and waits for the confirmation to hold focus. */
async function openConfirmation(
  locale: Parameters<typeof focusEditorOption>[0],
  change?: Promise<void>,
) {
  const view = await focusEditorOption(locale, change);
  pressKey('Enter');
  await settledConfirmation(CONFIRM_DIALOG);
  return view;
}

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('where focus goes when the role confirmation closes in %s', (locale) => {
  it('returns to the role selector after Escape', async () => {
    const { onRoleChange } = await openConfirmation(locale);

    fireEvent.keyDown(screen.getByTestId(CONFIRM_DIALOG), { key: 'Escape' });

    expect(await focusAfterClose(CONFIRM_DIALOG)).toBe(SELECTOR);
    expect(onRoleChange).not.toHaveBeenCalled();
  });

  it('returns to the role selector after Cancel is pressed with the keyboard', async () => {
    const { onRoleChange } = await openConfirmation(locale);

    screen.getByTestId('cancel-role-change-button').focus();
    pressKey('Enter');

    expect(await focusAfterClose(CONFIRM_DIALOG)).toBe(SELECTOR);
    expect(onRoleChange).not.toHaveBeenCalled();
  });

  it('returns to the role selector after Cancel is clicked', async () => {
    const { onRoleChange } = await openConfirmation(locale);

    fireEvent.click(screen.getByTestId('cancel-role-change-button'));

    expect(await focusAfterClose(CONFIRM_DIALOG)).toBe(SELECTOR);
    expect(onRoleChange).not.toHaveBeenCalled();
  });

  it('returns to the role selector, now showing the new role, after the change is confirmed', async () => {
    const held = Promise.withResolvers<void>();
    const { onRoleChange, successToasts, format, trigger } = await openConfirmation(
      locale,
      held.promise,
    );

    screen.getByTestId('confirm-role-change-button').focus();
    pressKey('Enter');

    await waitFor(() =>
      expect(availability(screen.getByTestId('confirm-role-change-button'))).toEqual(HELD),
    );
    expect(screen.getByTestId(CONFIRM_DIALOG).contains(document.activeElement)).toBe(true);
    held.resolve();

    expect(await focusAfterClose(CONFIRM_DIALOG)).toBe(SELECTOR);
    expect(trigger.textContent).toBe('Editor');
    expect(onRoleChange.mock.calls).toEqual([['editor']]);
    expect(successToasts()).toEqual([
      format('permissions.userRole.changeSuccess', { role: 'Editor' }),
    ]);
  });
});
