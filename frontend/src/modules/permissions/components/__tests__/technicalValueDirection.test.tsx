// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import type { Role } from '../../api/rolesApi';
import { PermissionNode } from '../permission-tree/PermissionNode';
import { RoleDetailPanel } from '../roles/RoleDetailPanel';
import { SearchPermissionGrid } from '../search/SearchPermissionGrid';
import { PermissionGroupGrid } from '../selector/PermissionGroupGrid';
import { CreateUserDialog } from '../users/CreateUserDialog';
import { EditUserDialog } from '../users/EditUserDialog';
import { UserCard } from '../users/UserCard';
import { UserPermissionsDialog } from '../users/UserPermissionsDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const PERMISSION = 'reports:read:all';
/** A leading digit is what a right-to-left line moves to the far end. */
const EMAIL = '123layla@example.com';
/** A number, a hyphen, then letters is the slug shape a right-to-left line reorders. */
const SLUG = '24-7-support';

const ROLE: Role = {
  id: 'role-support',
  name: 'Support',
  slug: SLUG,
  isSystemRole: false,
  isProtected: false,
  level: 1,
  permissions: [],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

const USER = {
  _id: 'user-1',
  name: 'Layla Haddad',
  email: EMAIL,
  role: 'user',
  isVerified: true,
  isDeleted: false,
  createdAt: '2026-10-01T12:00:00.000Z',
};

/** The direction of a value and of the line that holds it. */
function valueAndLine(value: HTMLElement) {
  return {
    text: value.textContent,
    value: value.getAttribute('dir'),
    line: value.parentElement ? directionOf(value.parentElement) : null,
  };
}

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('technical values in an rtl page in %s', (locale) => {
  it('keeps a permission key left to right in the tree', async () => {
    await renderForm(locale, <PermissionNode permission={PERMISSION} />);

    const node = screen.getByTestId(`permission-node-${PERMISSION}`);
    expect({
      text: node.textContent,
      resource: directionOf(within(node).getByText('reports')),
      node: directionOf(node),
    }).toEqual({ text: PERMISSION, resource: 'ltr', node: 'rtl' });
  });

  it.each([
    ['selector', PermissionGroupGrid],
    ['search', SearchPermissionGrid],
  ] as const)('keeps a permission key left to right in the %s grid', async (_name, Grid) => {
    await renderForm(
      locale,
      <Grid
        permissions={{ READ_ALL: PERMISSION }}
        selectedPermissions={[]}
        onTogglePermission={vi.fn()}
      />,
    );

    expect(valueAndLine(screen.getByText(PERMISSION))).toEqual({
      text: PERMISSION,
      value: 'ltr',
      line: 'rtl',
    });
  });

  it('keeps a direct permission key left to right in the user dialog', async () => {
    stubNetwork(() => success({ userId: USER._id, role: '', permissions: [PERMISSION] }));
    await renderForm(
      locale,
      <UserPermissionsDialog open onOpenChange={vi.fn()} userId={USER._id} />,
    );

    const row = await screen.findByTestId(`direct-permission-${PERMISSION}`);
    expect(valueAndLine(within(row).getByText(PERMISSION))).toEqual({
      text: PERMISSION,
      value: 'ltr',
      line: 'rtl',
    });
  });

  it('keeps a role slug left to right under the role name', async () => {
    await renderForm(locale, <RoleDetailPanel role={ROLE} />);

    expect(valueAndLine(screen.getByTestId('role-detail-slug'))).toEqual({
      text: SLUG,
      value: 'ltr',
      line: 'rtl',
    });
  });

  it('keeps a user address left to right on the user card', async () => {
    await renderForm(locale, <UserCard user={USER} />);

    expect(valueAndLine(screen.getByTestId('user-card-email'))).toEqual({
      text: EMAIL,
      value: 'ltr',
      line: 'rtl',
    });
  });

  it('types an address left to right and a name in the page direction when creating a user', async () => {
    stubNetwork(() => success({ roles: [], total: 0, page: 1 }));
    const { message } = await renderForm(locale, <CreateUserDialog open onOpenChange={vi.fn()} />);

    expect({
      email: directionOf(screen.getByRole('textbox', { name: message('users.createUser.email') })),
      name: directionOf(screen.getByRole('textbox', { name: message('users.createUser.name') })),
    }).toEqual({ email: 'ltr', name: 'rtl' });
  });

  it('types an address left to right and a name in the page direction when editing a user', async () => {
    const { message } = await renderForm(
      locale,
      <EditUserDialog
        userId={USER._id}
        currentName={USER.name}
        currentEmail={EMAIL}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect({
      email: directionOf(screen.getByRole('textbox', { name: message('users.editUser.email') })),
      name: directionOf(screen.getByRole('textbox', { name: message('users.editUser.name') })),
    }).toEqual({ email: 'ltr', name: 'rtl' });
  });
});
