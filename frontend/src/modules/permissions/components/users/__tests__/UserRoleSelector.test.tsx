// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ADMIN_LISTED, storeSignedInAs } from '@/tests/signedIn';
import { useUserActions } from '../../../hooks/useUserActions';
import { UserRoleSelector } from '../UserRoleSelector';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

function role(slug: string, name: string) {
  return {
    id: `role-${slug}`,
    slug,
    name,
    level: 1,
    permissions: [],
    isSystemRole: false,
    isProtected: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

const ROLES = {
  roles: [ADMIN_LISTED, role('user', 'User'), role('editor', 'Editor')],
  total: 3,
  page: 1,
};

const UPDATED_USER = {
  id: 'user-2',
  email: 'omar@example.com',
  name: 'Omar Nasser',
  role: 'editor',
  isVerified: true,
  isDeleted: false,
  authProvider: 'email',
  linkedProviders: ['email'],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

/** The selector wired to the real role-change action, as the user card wires it. */
function UserRoleControl() {
  const { handleRoleChange } = useUserActions();
  return (
    <UserRoleSelector
      userId="user-2"
      currentRole="user"
      onRoleChange={(newRole) => handleRoleChange('user-2', newRole)}
    />
  );
}

async function changeRoleToEditor(locale: AppLocale, answer: () => Response) {
  const requests = stubNetwork((request) => (request.method === 'GET' ? success(ROLES) : answer()));
  const form = await renderForm(locale, <UserRoleControl />, storeSignedInAs('admin'));

  const trigger = screen.getByRole('combobox');
  await waitFor(() => {
    expect(trigger.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.keyDown(await screen.findByRole('option', { name: 'Editor' }), { key: 'Enter' });
  fireEvent.click(
    await screen.findByRole('button', { name: form.message('permissions.userRole.changeRole') }),
  );
  await waitFor(() => {
    expect(requests).toEqual(['GET /api/roles', 'PATCH /api/admin/users/user-2/role']);
  });
  return form;
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
] as const)('changing a user role in %s', (locale) => {
  it('shows one success message when the server accepts it', async () => {
    const { format, errorToasts, successToasts } = await changeRoleToEditor(locale, () =>
      success(UPDATED_USER),
    );

    await waitFor(() => {
      expect(successToasts()).toEqual([
        format('permissions.userRole.changeSuccess', { role: 'Editor' }),
      ]);
    });
    expect(errorToasts()).toEqual([]);
  });

  it('shows one failure message and no success when the server refuses it', async () => {
    const { message, errorToasts, successToasts } = await changeRoleToEditor(locale, () =>
      refusalWith(403, 'CANNOT_MODIFY_HIGHER_ROLE'),
    );

    await waitFor(() => {
      expect(errorToasts()).toEqual([message('errors.codes.CANNOT_MODIFY_HIGHER_ROLE')]);
    });
    // The selector is enabled again once the refusal has been handled.
    await waitFor(() => {
      expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false);
    });
    expect(successToasts()).toEqual([]);
  });
});
