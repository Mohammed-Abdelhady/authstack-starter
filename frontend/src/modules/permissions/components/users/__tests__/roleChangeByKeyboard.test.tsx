// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { UserActionsMenu } from '../UserActionsMenu';
import { UserRoleSelector } from '../UserRoleSelector';
import { pressKey } from './keystroke';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

function role(slug: string, name: string) {
  return {
    id: `role-${slug}`,
    slug,
    name,
    permissions: [],
    isSystemRole: false,
    isProtected: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

const ROLES = { roles: [role('user', 'User'), role('editor', 'Editor')], total: 2, page: 1 };

const MENU_USER = {
  _id: 'user-7',
  name: 'Omar Nasser',
  email: 'omar@example.com',
  role: 'editor',
  isDeleted: false,
  isVerified: true,
};

/** Opens the role list by keyboard and puts focus on the "Editor" option. */
async function focusEditorOption(locale: AppLocale) {
  const requests = stubNetwork(() => success(ROLES));
  const onRoleChange = vi.fn(async () => undefined);
  const form = await renderForm(
    locale,
    <UserRoleSelector userId="user-2" currentRole="user" onRoleChange={onRoleChange} />,
  );
  const trigger = screen.getByRole('combobox');
  await waitFor(() => {
    expect(trigger.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  (await screen.findByRole('option', { name: 'Editor' })).focus();
  return { ...form, requests, onRoleChange };
}

/** What the page shows a moment after a keystroke: the dialog, and where focus is. */
async function settledConfirmation(testId: string) {
  const dialog = await screen.findByTestId(testId);
  // Give a keystroke that closes the dialog again the time to do so.
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  return {
    open: screen.queryByTestId(testId) !== null,
    listOpen: screen.queryByRole('listbox') !== null,
  };
}

beforeAll(() => {
  // The listbox of the select needs two DOM methods jsdom does not have.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => undefined;
});

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('choosing a role by keyboard in %s', (locale) => {
  it.each(['Enter', ' '] as const)(
    'opens the confirmation and leaves it open when the key is "%s"',
    async (key) => {
      const { onRoleChange } = await focusEditorOption(locale);

      pressKey(key);

      expect(await settledConfirmation('role-change-confirm-dialog')).toEqual({
        open: true,
        listOpen: false,
      });
      expect(onRoleChange).not.toHaveBeenCalled();
    },
  );

  it('changes the role when Enter is pressed on the option and then on the confirm button', async () => {
    const { onRoleChange, message } = await focusEditorOption(locale);

    pressKey('Enter');
    await settledConfirmation('role-change-confirm-dialog');
    screen.getByRole('button', { name: message('permissions.userRole.changeRole') }).focus();
    pressKey('Enter');

    await waitFor(() => {
      expect(onRoleChange.mock.calls).toEqual([['editor']]);
    });
  });

  it('keeps the deactivate confirmation open when its menu entry is chosen with Enter', async () => {
    const requests = stubNetwork(() => success({ id: MENU_USER._id, isDeleted: true }));
    await renderForm(locale, <UserActionsMenu user={MENU_USER} />);
    fireEvent.keyDown(screen.getByTestId('user-actions-menu-user-7'), { key: 'Enter' });
    (await screen.findByTestId('deactivate-user-user-7')).focus();

    pressKey('Enter');

    expect((await settledConfirmation('user-action-confirm-dialog')).open).toBe(true);
    expect(requests).toEqual([]);
  });
});
