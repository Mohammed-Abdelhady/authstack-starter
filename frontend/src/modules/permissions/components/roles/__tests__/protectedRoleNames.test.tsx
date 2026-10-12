// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  renderForm,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { listedRole } from '@/tests/roleList';
import { storeSignedInAs } from '@/tests/signedIn';
import { RoleSidebarNav } from '@/modules/permissions/components/roles/RoleSidebarNav';
import { UserRoleSelector } from '@/modules/permissions/components/users/UserRoleSelector';
import { stubListLayout } from '@/modules/permissions/components/users/__tests__/roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const PROTECTED_ROLE = {
  ...listedRole('manager', 'Manager'),
  isSystemRole: true,
  isProtected: true,
};

registerFormTestLifecycle();
beforeAll(stubListLayout);

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('protected role names in %s', (locale: AppLocale) => {
  it('announces the lock icon in the role sidebar item name', async () => {
    const form = await renderForm(
      locale,
      <RoleSidebarNav
        roles={[PROTECTED_ROLE]}
        selectedRoleId={PROTECTED_ROLE.id}
        onSelectRole={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: `Manager ${form.message('roles.detail.protectedBadge')}`,
      }),
    ).toBeTruthy();
  });

  it('announces the protection icon in the role selector option name', async () => {
    stubNetwork(() => success({ roles: [PROTECTED_ROLE], total: 1, page: 1, pages: 1 }));
    const form = await renderForm(
      locale,
      <UserRoleSelector userId="user-1" currentRole="manager" />,
      storeSignedInAs('admin'),
    );
    const trigger = await screen.findByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(
      await screen.findByRole('option', {
        name: `Manager ${form.message('roles.detail.protectedBadge')}`,
      }),
    ).toBeTruthy();
  });
});
