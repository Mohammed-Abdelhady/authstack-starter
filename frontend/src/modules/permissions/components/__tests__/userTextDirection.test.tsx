// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Direction } from 'radix-ui';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import type { Role } from '../../api/rolesApi';
import { DeleteRoleDialog } from '../roles/DeleteRoleDialog';
import { RoleDetailPanel } from '../roles/RoleDetailPanel';
import { RoleSidebarNav } from '../roles/RoleSidebarNav';
import { CreateUserDialog } from '../users/CreateUserDialog';
import { UserActionConfirmDialog } from '../users/UserActionConfirmDialog';
import { UserCard } from '../users/UserCard';
import { UserRoleSelector } from '../users/UserRoleSelector';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/**
 * A name is text in a language nobody knows ahead: one starts with digits, which
 * a right-to-left line moves to the far end, and one is in a right-to-left
 * script, which must not be forced left to right.
 */
const NAMES = [
  ['a Latin name starting with digits', '24-7 Support', '24-7 team on call'],
  ['an Arabic name', 'دعم العملاء', 'فريق الدعم على مدار الساعة'], // feature:locale-ar
] as const;

function role(name: string, description: string): Role {
  return {
    id: 'role-support',
    name,
    slug: 'support-team',
    description,
    isSystemRole: false,
    isProtected: false,
    permissions: ['users:read:all'],
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

/** First-strong isolation on the value, in a line that keeps the page direction. */
function valueAndLine(value: HTMLElement) {
  return {
    text: value.textContent,
    value: value.getAttribute('dir'),
    line: value.parentElement ? directionOf(value.parentElement) : null,
  };
}

registerFormTestLifecycle();
registerRtlDocument();
// jsdom has no layout: an open Radix list scrolls its selected option into view.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('text a person typed, in an rtl page in %s', (locale) => {
  describe.each(NAMES)('%s', (_kind, name, description) => {
    const expected = { text: name, value: 'auto', line: 'rtl' };

    it('takes its own direction in the roles sidebar', async () => {
      await renderForm(
        locale,
        <RoleSidebarNav
          roles={[role(name, description)]}
          selectedRoleId={null}
          onSelectRole={vi.fn()}
        />,
      );

      const item = screen.getByRole('button', { name });
      expect(valueAndLine(within(item).getByText(name))).toEqual(expected);
    });

    it('takes its own direction in the role heading and description', async () => {
      await renderForm(locale, <RoleDetailPanel role={role(name, description)} />);

      expect(valueAndLine(screen.getByTestId('role-detail-name'))).toEqual(expected);
      expect(valueAndLine(screen.getByTestId('role-detail-description'))).toEqual({
        text: description,
        value: 'auto',
        line: 'rtl',
      });
    });

    it('takes its own direction in the role selector of a user card', async () => {
      stubNetwork(() => success({ roles: [role(name, description)], total: 1, page: 1 }));
      // Radix reads the direction from its provider, as the locale layout sets it.
      await renderForm(
        locale,
        <Direction.DirectionProvider dir="rtl">
          <UserRoleSelector userId="user-1" currentRole="support-team" />
        </Direction.DirectionProvider>,
      );

      expect(valueAndLine(await screen.findByText(name))).toEqual(expected);
    });

    it('takes its own direction in the open role list and in the change confirmation', async () => {
      stubNetwork(() => success({ roles: [role(name, description)], total: 1, page: 1 }));
      await renderForm(
        locale,
        <Direction.DirectionProvider dir="rtl">
          <UserRoleSelector userId="user-1" currentRole="user" />
        </Direction.DirectionProvider>,
      );
      const trigger = screen.getByRole('combobox');
      await waitFor(() => {
        expect(trigger.hasAttribute('disabled')).toBe(false);
      });

      fireEvent.keyDown(trigger, { key: 'Enter' });

      const option = await screen.findByRole('option', { name });
      expect(valueAndLine(within(option).getByText(name))).toEqual(expected);

      fireEvent.keyDown(option, { key: 'Enter' });

      const confirmation = await screen.findByRole('alertdialog');
      expect(valueAndLine(within(confirmation).getByText(name))).toEqual(expected);
    });

    it('takes its own direction in the role list of the create user dialog', async () => {
      stubNetwork(() => success({ roles: [role(name, description)], total: 1, page: 1 }));
      const { message } = await renderForm(
        locale,
        <Direction.DirectionProvider dir="rtl">
          <CreateUserDialog open onOpenChange={vi.fn()} />
        </Direction.DirectionProvider>,
      );
      const trigger = screen.getByRole('combobox', { name: message('users.createUser.role') });
      await waitFor(() => {
        expect(trigger.hasAttribute('disabled')).toBe(false);
      });

      fireEvent.keyDown(trigger, { key: 'Enter' });

      const option = await screen.findByRole('option', { name });
      expect(valueAndLine(within(option).getByText(name))).toEqual(expected);
    });

    it('takes its own direction in the notice that a protected role cannot be deleted', async () => {
      await renderForm(
        locale,
        <DeleteRoleDialog
          open
          onOpenChange={vi.fn()}
          role={{ ...role(name, description), isProtected: true }}
        />,
      );

      expect(valueAndLine(within(screen.getByRole('dialog')).getByText(name))).toEqual(expected);
    });

    it('takes its own direction in the summary of the role about to be deleted', async () => {
      await renderForm(
        locale,
        <DeleteRoleDialog open onOpenChange={vi.fn()} role={role(name, description)} />,
      );

      expect(valueAndLine(screen.getByTestId('delete-role-name'))).toEqual(expected);
      expect(valueAndLine(screen.getByText(description))).toEqual({
        text: description,
        value: 'auto',
        line: 'rtl',
      });
    });

    it('takes its own direction as the user name on a card', async () => {
      await renderForm(
        locale,
        <UserCard
          user={{
            _id: 'user-1',
            name,
            email: 'layla@example.com',
            role: 'user',
            isVerified: true,
            isDeleted: false,
            createdAt: '2026-10-01T12:00:00.000Z',
          }}
        />,
      );

      expect(valueAndLine(screen.getByTestId('user-card-name'))).toEqual(expected);
    });

    it('takes its own direction as the user name inside a confirmation sentence', async () => {
      await renderForm(
        locale,
        <UserActionConfirmDialog
          action="deactivate"
          userName={name}
          isLoading={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      const sentence = screen.getByRole('alertdialog');
      expect(valueAndLine(within(sentence).getByText(name))).toEqual(expected);
    });
  });
});
