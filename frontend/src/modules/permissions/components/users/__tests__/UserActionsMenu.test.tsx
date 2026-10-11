// @vitest-environment jsdom
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
  _id: 'user-7',
  name: 'Omar Nasser',
  email: 'omar@example.com',
  role: 'editor',
  isDeleted: false,
  isVerified: true,
};

/** The test ids of the entries in the open menu, in order. */
async function openMenu(locale: AppLocale, user = USER) {
  const form = await renderForm(locale, <UserActionsMenu user={user} />);
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
  it('offers deactivate as the only way to take an active account out of use', async () => {
    const { entries } = await openMenu(locale);

    expect(entries).toEqual([
      'edit-user-user-7',
      'manage-permissions-user-7',
      'deactivate-user-user-7',
    ]);
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
    const requests = stubNetwork(() => success({ id: USER._id, isDeleted: true }));
    const { format, successToasts } = await openMenu(locale);

    fireEvent.click(screen.getByTestId('deactivate-user-user-7'));
    fireEvent.click(await screen.findByTestId('confirm-user-action-button'));

    await waitFor(() => {
      expect(successToasts()).toEqual([
        format('users.actions.deactivateSuccess', { name: USER.name }),
      ]);
    });
    expect(requests).toEqual(['PATCH /api/admin/users/user-7/status']);
  });
});
