// @vitest-environment jsdom
import { storeSignedInAs } from '@/tests/signedIn';
import { USER_PERMISSIONS } from '@app/core';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { UserActionsMenu } from '../UserActionsMenu';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  version: 0,
  _id: 'user-7',
  name: 'Omar Nasser',
  email: 'omar@example.com',
  role: 'editor',
  isDeleted: false,
  isVerified: true,
};

/** The test ids of the entries in the open menu, in order. */
async function openMenu(
  locale: AppLocale,
  user = USER,
  permissions = [USER_PERMISSIONS.UPDATE_ALL, USER_PERMISSIONS.SUSPEND_ALL],
) {
  const form = await renderForm(
    locale,
    <UserActionsMenu user={user} />,
    storeSignedInAs('admin', permissions),
  );
  fireEvent.keyDown(screen.getByTestId(`user-actions-menu-${user._id}`), { key: 'Enter' });
  const menu = await screen.findByRole('menu');
  const entries = [...menu.querySelectorAll('[role="menuitem"]')].map((entry) =>
    entry.getAttribute('data-testid'),
  );
  return { ...form, entries };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the actions of a user row in %s', (locale) => {
  // Failure: update-only staff see an unusable suspension action while suspend-only staff cannot reach it.
  it('exposes suspension only to the suspension permission independently of update', async () => {
    const { unmount } = await openMenu(locale, USER, [USER_PERMISSIONS.UPDATE_ALL]);
    expect(screen.queryByTestId('deactivate-user-user-7')).toBeNull();
    unmount();
    await openMenu(locale, USER, [USER_PERMISSIONS.SUSPEND_ALL]);
    expect(screen.queryByTestId('edit-user-user-7')).toBeNull();
    expect(screen.getByTestId('deactivate-user-user-7')).toBeTruthy();
  });

  it('offers activate for an account that is inactive', async () => {
    const { entries } = await openMenu(locale, { ...USER, isDeleted: true });

    expect(entries).toEqual([
      'edit-user-user-7',
      'manage-permissions-user-7',
      'activate-user-user-7',
    ]);
  });

  it('deactivates through the status route after the confirmation', async () => {
    const bodies: unknown[] = [];
    const requests = stubNetwork(async (request) => {
      bodies.push(await request.json());
      return success({ id: USER._id, isDeleted: true });
    });
    const { format, successToasts } = await openMenu(locale);

    fireEvent.click(screen.getByTestId('deactivate-user-user-7'));
    fireEvent.click(await screen.findByTestId('confirm-user-action-button'));

    await waitFor(() => {
      expect(successToasts()).toEqual([
        format('users.actions.deactivateSuccess', { name: USER.name }),
      ]);
    });
    expect(requests).toEqual(['PATCH /api/admin/users/user-7/status']);
    expect(bodies).toEqual([{ version: 0, isActive: false }]);
  });
});
