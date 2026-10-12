// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { RoleFilter } from '@/modules/users/components/RoleFilter';
import { UserListToolbar } from '@/modules/users/components/UserListToolbar';
import type { Role } from '../../api/rolesApi';
import { CreateRoleDialog } from '../roles/CreateRoleDialog';
import { EditRoleDialog } from '../roles/EditRoleDialog';
import { CreateUserDialog } from '../users/CreateUserDialog';
import { EditUserDialog } from '../users/EditUserDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** Digits, a slash, then letters: the text a right-to-left field shows as "Support 24/7". */
const MIXED_TEXT = '24/7 Support';

const ROLE: Role = {
  id: 'role-support',
  name: 'Support Team',
  slug: 'support-team',
  description: 'Answers tickets',
  isSystemRole: false,
  isProtected: false,
  level: 1,
  permissions: ['users:read:all'],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

const noop = () => undefined;

interface FreeTextField {
  name: string;
  render: () => ReactElement;
  testId: string;
  /** Brings the field on screen when it is not there from the start. */
  open?: () => void;
}

/** Every free-text field of the admin screens. */
const FIELDS: FreeTextField[] = [
  {
    name: 'the role name when creating',
    render: () => <CreateRoleDialog open onOpenChange={noop} />,
    testId: 'role-name-input',
  },
  {
    name: 'the role description when creating',
    render: () => <CreateRoleDialog open onOpenChange={noop} />,
    testId: 'role-description-input',
  },
  {
    name: 'the role name when editing',
    render: () => <EditRoleDialog open onOpenChange={noop} role={ROLE} />,
    testId: 'edit-role-name-input',
  },
  {
    name: 'the role description when editing',
    render: () => <EditRoleDialog open onOpenChange={noop} role={ROLE} />,
    testId: 'edit-role-description-input',
  },
  {
    name: 'the user name when creating',
    render: () => <CreateUserDialog open onOpenChange={noop} />,
    testId: 'create-user-name-input',
  },
  {
    name: 'the user name when editing',
    render: () => (
      <EditUserDialog
        open
        onOpenChange={noop}
        userId="user-1"
        currentName="Layla Haddad"
        currentEmail="layla@example.com"
      />
    ),
    testId: 'edit-user-name-input',
  },
  {
    name: 'the user search',
    render: () => (
      <UserListToolbar
        searchQuery=""
        onSearchChange={noop}
        onSearchClear={noop}
        roleFilter="all"
        onRoleFilterChange={noop}
      />
    ),
    testId: 'search-users-input',
  },
  {
    name: 'the role search of the role filter',
    render: () => <RoleFilter value="all" onChange={noop} />,
    testId: 'role-filter-search',
    open: () => fireEvent.click(screen.getByTestId('role-filter')),
  },
];

/** jsdom has no layout, so the observer a checked Radix checkbox asks for never fires. */
class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

registerFormTestLifecycle();
registerRtlDocument();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a free-text field in an rtl page in %s', (locale) => {
  it.each(FIELDS)(
    'keeps the page direction for $name, so its text stays at the start edge',
    async ({ render, testId, open }) => {
      stubNetwork(() => success({ roles: [], total: 0, page: 1, totalPages: 1 }));
      await renderForm(locale, render());
      open?.();

      const field = await screen.findByTestId(testId);
      fireEvent.change(field, { target: { value: MIXED_TEXT } });

      expect({ own: field.getAttribute('dir'), inForce: directionOf(field) }).toEqual({
        own: null,
        inForce: 'rtl',
      });
    },
  );

  it('keeps an address field left to right', async () => {
    stubNetwork(() => success({ roles: [], total: 0, page: 1, totalPages: 1 }));
    await renderForm(locale, <CreateUserDialog open onOpenChange={noop} />);

    expect(screen.getByTestId('create-user-email-input').getAttribute('dir')).toBe('ltr');
  });
});
