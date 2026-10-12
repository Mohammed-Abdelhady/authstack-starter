// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ADMIN_LISTED, storeSignedInAs } from '@/tests/signedIn';
import { UserRoleSelector } from '../UserRoleSelector';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ROLES = {
  roles: [
    ADMIN_LISTED,
    {
      id: 'role-editor',
      slug: 'editor',
      name: 'Editor',
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

/** Opens the confirmation for a change to "Editor" and returns it. */
async function confirmationFor(locale: AppLocale, userName?: string) {
  stubNetwork(() => success(ROLES));
  const form = await renderForm(
    locale,
    <UserRoleSelector userId="user-1" currentRole="user" userName={userName} />,
    storeSignedInAs('admin'),
  );
  const trigger = screen.getByRole('combobox');
  await waitFor(() => {
    expect(trigger.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.keyDown(await screen.findByRole('option', { name: 'Editor' }), { key: 'Enter' });
  return { ...form, confirmation: await screen.findByRole('alertdialog') };
}

registerFormTestLifecycle();
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
] as const)('the user named in the role change confirmation in %s', (locale) => {
  it.each([
    ['a Latin name', 'Layla Haddad'],
    ['an Arabic name', 'ليلى حداد'], // feature:locale-ar
  ])('is the user by name, in the name’s own direction: %s', async (_kind, userName) => {
    const { confirmation, message } = await confirmationFor(locale, userName);

    expect(within(confirmation).getByText(userName).getAttribute('dir')).toBe('auto');
    expect(confirmation.textContent).not.toContain(message('permissions.userRole.thisUser'));
  });

  it.each([
    ['no name', undefined],
    ['an empty name', ''],
    ['a name of spaces', '   '],
  ])('is the translated fallback for a user with %s', async (_kind, userName) => {
    const { confirmation, message } = await confirmationFor(locale, userName);

    const fallback = within(confirmation).getByText(message('permissions.userRole.thisUser'));
    expect(fallback.getAttribute('dir')).toBe('auto');
  });
});
