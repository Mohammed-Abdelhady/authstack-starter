// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { availability, heldAnswer, HELD } from '@/tests/busyControls';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { UserActionsMenu } from '../UserActionsMenu';
import { UserPermissionsDialog } from '../UserPermissionsDialog';
import { pressKey } from './keystroke';
import { focusAfterClose, settledConfirmation } from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  _id: 'user-7',
  name: 'Omar Nasser',
  email: 'omar@example.com',
  role: 'editor',
  isDeleted: false,
  isVerified: true,
};

const MENU_BUTTON = 'user-actions-menu-user-7';
const CONFIRM_DIALOG = 'user-action-confirm-dialog';
const EDIT_DIALOG = 'edit-user-dialog';
const PERMISSIONS_DIALOG = 'user-permissions-dialog';

/** The menu with the permissions dialog beside it, wired the way the users page wires them. */
function MenuWithPermissionsDialog({ user }: { user: typeof USER }) {
  const [managing, setManaging] = useState(false);
  const [openerRef, returnFocusToOpener] = useReturnFocus();
  return (
    <>
      <UserActionsMenu
        user={user}
        onManagePermissions={(menuButton) => {
          openerRef.current = menuButton;
          setManaging(true);
        }}
      />
      <UserPermissionsDialog
        userId={managing ? user._id : ''}
        open={managing}
        onOpenChange={setManaging}
        onCloseAutoFocus={returnFocusToOpener}
      />
    </>
  );
}

/** Opens the menu by keyboard and chooses one of its entries with Enter. */
async function chooseEntry(
  locale: AppLocale,
  entry: string,
  user = USER,
  actionAnswer?: Promise<Response>,
) {
  const requests = stubNetwork((request, path) =>
    request.method === 'PATCH' && actionAnswer
      ? actionAnswer
      : path.endsWith('/permissions')
        ? success({ userId: user._id, role: user.role, permissions: [] })
        : success({ id: user._id, isDeleted: !user.isDeleted, permissions: [] }),
  );
  const form = await renderForm(locale, <MenuWithPermissionsDialog user={user} />);
  const menuButton = screen.getByTestId(MENU_BUTTON);
  menuButton.focus();
  fireEvent.keyDown(menuButton, { key: 'Enter' });
  (await screen.findByTestId(`${entry}-user-7`)).focus();
  pressKey('Enter');
  return { ...form, requests };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('where focus goes when a dialog of the actions menu closes in %s', (locale) => {
  it.each([
    ['deactivate-user', USER],
    ['activate-user', { ...USER, isDeleted: true }],
  ] as const)(
    'returns to the menu button when the confirmation of %s is cancelled',
    async (entry, user) => {
      const { requests } = await chooseEntry(locale, entry, user);
      await settledConfirmation(CONFIRM_DIALOG);

      fireEvent.click(screen.getByTestId('cancel-user-action-button'));

      expect(await focusAfterClose(CONFIRM_DIALOG)).toBe(MENU_BUTTON);
      expect(requests).toEqual([]);
    },
  );

  it('returns to the menu button when the deactivate confirmation is closed with Escape', async () => {
    await chooseEntry(locale, 'deactivate-user');
    await settledConfirmation(CONFIRM_DIALOG);

    fireEvent.keyDown(screen.getByTestId(CONFIRM_DIALOG), { key: 'Escape' });

    expect(await focusAfterClose(CONFIRM_DIALOG)).toBe(MENU_BUTTON);
  });

  it('returns to the menu button after the account is deactivated', async () => {
    const held = heldAnswer();
    const { requests } = await chooseEntry(locale, 'deactivate-user', USER, held.answer);
    await settledConfirmation(CONFIRM_DIALOG);

    screen.getByTestId('confirm-user-action-button').focus();
    pressKey('Enter');

    await waitFor(() =>
      expect(availability(screen.getByTestId('confirm-user-action-button'))).toEqual(HELD),
    );
    expect(screen.getByTestId(CONFIRM_DIALOG).contains(document.activeElement)).toBe(true);
    held.settle(() => success({ id: USER._id, isDeleted: true, permissions: [] }));

    expect(await focusAfterClose(CONFIRM_DIALOG)).toBe(MENU_BUTTON);
    expect(requests).toEqual(['PATCH /api/admin/users/user-7/status']);
  });

  it('returns to the menu button when the edit dialog is closed with Escape', async () => {
    await chooseEntry(locale, 'edit-user');
    await settledConfirmation(EDIT_DIALOG);

    fireEvent.keyDown(screen.getByTestId(EDIT_DIALOG), { key: 'Escape' });

    expect(await focusAfterClose(EDIT_DIALOG)).toBe(MENU_BUTTON);
  });

  it('returns to the menu button when the edit dialog is cancelled', async () => {
    await chooseEntry(locale, 'edit-user');
    await settledConfirmation(EDIT_DIALOG);

    fireEvent.click(screen.getByTestId('cancel-edit-user-button'));

    expect(await focusAfterClose(EDIT_DIALOG)).toBe(MENU_BUTTON);
  });

  it('returns to the menu button when the permissions dialog is closed', async () => {
    await chooseEntry(locale, 'manage-permissions');
    await settledConfirmation(PERMISSIONS_DIALOG);

    fireEvent.keyDown(screen.getByTestId(PERMISSIONS_DIALOG), { key: 'Escape' });

    expect(await focusAfterClose(PERMISSIONS_DIALOG)).toBe(MENU_BUTTON);
  });
});
