// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
} from '@/tests/serverRejectionHarness';
import { DeleteRoleDialog } from '../DeleteRoleDialog';
import type { Role } from '../../../api/rolesApi';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ROLE = {
  version: 0,
  id: 'role-editor',
  name: 'Editor',
  slug: 'editor',
  isSystemRole: false,
  isProtected: false,
  level: 1,
  permissions: ['posts:read:all'],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('DeleteRoleDialog refused by the server in %s', (locale) => {
  it('says once, inside the dialog, how many users still hold the role', async () => {
    const requests = stubNetwork(() => refusalWith(400, 'ROLE_HAS_USERS', { count: 3 }));
    const onOpenChange = vi.fn();

    const { message, format, errorToasts, successToasts } = await renderForm(
      locale,
      <DeleteRoleDialog open onOpenChange={onOpenChange} role={ROLE} />,
    );
    fireEvent.click(screen.getByRole('button', { name: message('roles.delete.confirm') }));

    const reason = await screen.findByTestId('delete-role-error');
    expect(reason.textContent).toBe(format('errors.codes.ROLE_HAS_USERS', { count: 3 }));
    expect(reason.textContent).toContain('3');
    expect(reason.getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('delete-role-dialog').contains(reason)).toBe(true);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    // Said once, where the person is looking.
    expect(errorToasts()).toEqual([]);
    expect(successToasts()).toEqual([]);
    expect(requests).toEqual(['DELETE /api/roles/role-editor']);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

it('refuses deletion without a real observed role version before issuing a request', async () => {
  const legacy: Role = { ...ROLE };
  delete legacy.version;
  const requests = stubNetwork(() => refusalWith(400, 'VALIDATION_ERROR'));
  const onOpenChange = vi.fn();
  const { message } = await renderForm(
    'en',
    <DeleteRoleDialog open role={legacy} onOpenChange={onOpenChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: message('roles.delete.confirm') }));
  await screen.findByRole('alert');
  expect(requests).toEqual([]);
  expect(onOpenChange).not.toHaveBeenCalled();
});
