// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ADMIN_LISTED, storeSignedInAs } from '@/tests/signedIn';
import { CreateUserDialog } from '../CreateUserDialog';
import { UserRoleSelector } from '../UserRoleSelector';
import { stubListLayout } from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const LONG_SLUG = '24-7-very-long-support-role-name-for-truncation';
const LONG_NAME = '24-7 Very Long Support Role Name For Truncation';

const ROLES = {
  roles: [
    ADMIN_LISTED,
    {
      id: 'role-long',
      slug: LONG_SLUG,
      name: LONG_NAME,
      level: 1,
      permissions: [],
      isSystemRole: false,
      isProtected: false,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
};

async function loaded(trigger: HTMLElement) {
  await waitFor(() => {
    expect(trigger.hasAttribute('disabled')).toBe(false);
  });
}

/** The selector of a user who holds `currentRole`, with the role list loaded. */
async function cardSelector(locale: AppLocale, currentRole: string) {
  stubNetwork(() => success(ROLES));
  const form = await renderForm(
    locale,
    <UserRoleSelector userId="user-1" currentRole={currentRole} />,
    storeSignedInAs('admin'),
  );
  await loaded(screen.getByTestId('user-role-selector-user-1'));
  return form;
}

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a long role name in a role selector in %s', (locale) => {
  it('is whole in the accessible name and in the text of the card selector', async () => {
    const { format } = await cardSelector(locale, LONG_SLUG);

    const trigger = screen.getByRole('combobox', {
      name: format('permissions.userRole.selectorLabel', { role: LONG_NAME }),
    });

    expect(trigger.textContent).toBe(LONG_NAME);
    expect(within(trigger).getByText(LONG_NAME).getAttribute('dir')).toBe('auto');
  });

  it('is whole in the open list of the card selector', async () => {
    await cardSelector(locale, 'user');

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    expect((await screen.findByRole('option', { name: LONG_NAME })).textContent).toBe(LONG_NAME);
  });

  it('names the card selector by the slug when the list does not hold the role', async () => {
    const { format } = await cardSelector(locale, 'night-shift');

    expect(
      screen.getByRole('combobox', {
        name: format('permissions.userRole.selectorLabel', { role: 'night-shift' }),
      }).textContent,
    ).toBe('night-shift');
  });

  it('is whole in the text of the create user selector, which keeps its field label', async () => {
    stubNetwork(() => success(ROLES));
    const { message } = await renderForm(
      locale,
      <CreateUserDialog open onOpenChange={vi.fn()} />,
      storeSignedInAs('admin'),
    );
    const trigger = screen.getByRole('combobox', { name: message('users.createUser.role') });
    await loaded(trigger);

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('option', { name: LONG_NAME }), { key: 'Enter' });

    await waitFor(() => {
      expect(trigger.textContent).toBe(LONG_NAME);
    });
    expect(within(trigger).getByText(LONG_NAME).getAttribute('dir')).toBe('auto');
    expect(screen.getByRole('combobox', { name: message('users.createUser.role') })).toBe(trigger);
  });
});
