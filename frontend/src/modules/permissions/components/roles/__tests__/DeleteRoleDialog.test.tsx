// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
} from '@/tests/serverRejectionHarness';
import { DeleteRoleDialog } from '../DeleteRoleDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ROLE = {
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
  it('says once, in the catalogue, how many users still hold the role', async () => {
    const requests = stubNetwork(() => refusalWith(400, 'ROLE_HAS_USERS', { count: 3 }));
    const onOpenChange = vi.fn();

    const { message, format, errorToasts, successToasts } = await renderForm(
      locale,
      <DeleteRoleDialog open onOpenChange={onOpenChange} role={ROLE} />,
    );
    fireEvent.click(screen.getByRole('button', { name: message('roles.delete.confirm') }));

    await waitFor(() => {
      expect(errorToasts()).toEqual([format('errors.codes.ROLE_HAS_USERS', { count: 3 })]);
    });
    expect(errorToasts()[0]).toContain('3');
    expect(errorToasts()[0]).not.toContain(SERVER_TEXT);
    expect(successToasts()).toEqual([]);
    expect(requests).toEqual(['DELETE /api/roles/role-editor']);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
