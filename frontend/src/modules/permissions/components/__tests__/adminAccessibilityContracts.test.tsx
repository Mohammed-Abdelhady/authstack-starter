// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Role } from '@/modules/roles/types';
import {
  descriptions,
  formatter,
  registerFormTestLifecycle,
  renderForm,
} from '@/tests/serverRejectionHarness';
import { loadMessages } from '@/i18n/load-messages';
import { RoleDetailPanel } from '../roles/RoleDetailPanel';
import { RoleSidebarNav } from '../roles/RoleSidebarNav';
import { PermissionTreeView } from '../permission-tree/PermissionTreeView';
import { PermissionSelector } from '../selector/PermissionSelector';
import { usePermissionLabel } from '../../hooks/usePermissionLabel';
import { UserListSection } from '../users/UserListSection';
import { UserPermissionsSummary } from '../users/UserPermissionsSummary';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ROLE: Role = {
  id: 'role-editor',
  name: 'Editor',
  slug: 'editor',
  isSystemRole: false,
  isProtected: false,
  level: 1,
  permissions: ['users:read:all', 'roles:read:all'],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

const BASE_ROLE: Role = { ...ROLE, id: 'role-user', name: 'User', slug: 'user', isProtected: true };
const PROTECTED_ROLE: Role = { ...ROLE, isProtected: true };

function PermissionLabelProbe() {
  const format = usePermissionLabel();
  return <output>{format('users:read:all')}</output>;
}

registerFormTestLifecycle();

describe.each(['en', 'ar'] as const)('admin accessibility contracts in %s', (locale) => {
  it('exposes user cards and permission nodes as list items', async () => {
    await renderForm(
      locale,
      <>
        <UserListSection id="verified" title="Verified users" count={1}>
          <li>user row</li>
        </UserListSection>
        <PermissionTreeView permissions={['users:read:all', 'roles:read:all']} />
      </>,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('list')).toHaveLength(3);
  });

  it('names the role navigation landmark', async () => {
    const { message } = await renderForm(
      locale,
      <RoleSidebarNav roles={[ROLE]} selectedRoleId={ROLE.id} onSelectRole={vi.fn()} />,
    );

    expect(
      screen.getByRole('navigation', { name: message('roles.sidebar.navigationLabel') }),
    ).not.toBeNull();
  });

  it('ties disabled base and protected role actions to their visible reasons', async () => {
    const baseView = await renderForm(locale, <RoleDetailPanel role={BASE_ROLE} />);
    const edit = screen.getByTestId('edit-role-button');
    const baseDelete = screen.getByTestId('delete-role-button');
    expect(edit.getAttribute('aria-describedby')).not.toBeNull();
    expect(descriptions(edit).join(' ')).toContain(
      baseView.message('roles.detail.baseRoleNoticeTitle'),
    );
    expect(descriptions(edit).join(' ')).toContain(baseView.message('roles.detail.baseRoleNotice'));
    expect(baseDelete.getAttribute('aria-describedby')).toBe(edit.getAttribute('aria-describedby'));
    baseView.unmount();

    const protectedView = await renderForm(locale, <RoleDetailPanel role={PROTECTED_ROLE} />);
    const deleteButton = screen.getByTestId('delete-role-button');
    expect(deleteButton.getAttribute('aria-describedby')).not.toBeNull();
    expect(descriptions(deleteButton).join(' ')).toContain(
      protectedView.message('roles.detail.protectedRoleNoticeTitle'),
    );
    expect(descriptions(deleteButton).join(' ')).toContain(
      protectedView.message('roles.detail.protectedRoleNotice'),
    );
  });

  it('names select-all actions with the permission group', async () => {
    const { message, format } = await renderForm(
      locale,
      <PermissionSelector selectedPermissions={[]} onChange={vi.fn()} showWildcard={false} />,
    );

    const group = message('permissions.selector.groups.users');
    expect(
      screen.getByRole('button', {
        name: format('permissions.selector.selectAllForGroup', { group }),
      }),
    ).not.toBeNull();
  });

  it('formats the permission summary as one localized message', async () => {
    const messages = await loadMessages(locale);
    const translate = formatter(locale, messages);
    const { format } = await renderForm(
      locale,
      <UserPermissionsSummary
        totalCount={3}
        inheritedCount={2}
        directCount={1}
        hasWildcard={false}
        t={(key, values) => translate(`permissions.dialog.${key}`, values)}
      />,
    );

    expect(
      screen.getByText(
        format('permissions.dialog.summary', {
          total: format('permissions.dialog.totalPermissions', { count: 3 }),
          inherited: 2,
          direct: 1,
        }),
      ),
    ).not.toBeNull();
  });

  it('formats permission action and scope through one catalogue message', async () => {
    const { message, format } = await renderForm(locale, <PermissionLabelProbe />);

    expect(
      screen.getByText(
        format('permissions.permissionLabelWithScope', {
          action: message('permissions.actions.read'),
          scope: message('permissions.scopes.all'),
        }),
      ),
    ).not.toBeNull();
  });
});
