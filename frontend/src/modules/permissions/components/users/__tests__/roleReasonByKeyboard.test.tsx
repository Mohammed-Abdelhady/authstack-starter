// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { listedRole } from '@/tests/roleList';
import {
  descriptions,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { storeSignedInAs } from '@/tests/signedIn';
import { CreateUserDialog } from '../CreateUserDialog';
import { UserRoleSelector } from '../UserRoleSelector';
import { stubListLayout } from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const SEEDED = [
  { ...listedRole('user', 'User', 1), isSystemRole: true, isProtected: true },
  { ...listedRole('support', 'Support', 2), isSystemRole: true, isProtected: true },
  { ...listedRole('manager', 'Manager', 3), isSystemRole: true, isProtected: true },
  { ...listedRole('admin', 'Admin', 4), isSystemRole: true, isProtected: true },
];

const option = (slug: string) => screen.getByTestId(`role-option-${slug}`);
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The open role list of the create user dialog, as a person holding `actorRole` sees it. */
async function openCreateUserList(locale: AppLocale, actorRole: string) {
  const requests = stubNetwork((request) =>
    request.method === 'GET'
      ? success({ roles: SEEDED, total: 4, page: 1, pages: 1 })
      : success({ id: 'user-9' }),
  );
  const form = await renderForm(
    locale,
    <CreateUserDialog open onOpenChange={vi.fn()} />,
    storeSignedInAs(actorRole),
  );
  const trigger = screen.getByRole('combobox', { name: form.message('users.createUser.role') });
  await waitFor(() => expect(trigger.matches(':disabled')).toBe(false));
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await screen.findByRole('listbox');
  await waitFor(() => expect(document.activeElement).toBe(option('user')));
  const reason = (kind: 'admin' | 'level') => form.message(`permissions.userRole.refusal.${kind}`);
  return { ...form, trigger, requests, reason };
}

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the reason a role cannot be assigned, by keyboard, in %s', (locale) => {
  it('is reached with the arrow keys by a manager, on their own role and on admin', async () => {
    const list = await openCreateUserList(locale, 'manager');

    fireEvent.keyDown(option('user'), { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(option('support')));
    expect(descriptions(option('support'))).toEqual([]);

    fireEvent.keyDown(option('support'), { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(option('manager')));
    expect(descriptions(option('manager'))).toEqual([list.reason('level')]);

    fireEvent.keyDown(option('manager'), { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(option('admin')));
    expect(descriptions(option('admin'))).toEqual([list.reason('admin')]);
  });

  it('is reached with End and by typing, and choosing that role does nothing', async () => {
    const list = await openCreateUserList(locale, 'admin');

    fireEvent.keyDown(option('user'), { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(option('admin')));
    expect(descriptions(option('admin'))).toEqual([list.reason('admin')]);
    expect(option('admin').getAttribute('aria-disabled')).toBe('true');

    fireEvent.keyDown(option('admin'), { key: 'Home' });
    await waitFor(() => expect(document.activeElement).toBe(option('user')));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'a' });
    await waitFor(() => expect(document.activeElement).toBe(option('admin')));

    fireEvent.keyDown(option('admin'), { key: 'Enter' });
    await settled();

    expect(screen.queryByRole('listbox')).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(list.trigger.textContent).toBe('User');
  });

  it('is reached on the selector of a user card, and the change is never asked for', async () => {
    const onRoleChange = vi.fn(async () => undefined);
    stubNetwork(() => success({ roles: SEEDED, total: 4, page: 1, pages: 1 }));
    const form = await renderForm(
      locale,
      <UserRoleSelector userId="user-2" currentRole="support" onRoleChange={onRoleChange} />,
      storeSignedInAs('manager'),
    );
    const trigger = await screen.findByRole('combobox', {
      name: form.format('permissions.userRole.selectorLabel', { role: 'Support' }),
    });
    await waitFor(() => expect(trigger.matches(':disabled')).toBe(false));
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('listbox');
    await waitFor(() => expect(document.activeElement).toBe(option('support')));

    fireEvent.keyDown(option('support'), { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(option('manager')));
    expect(descriptions(option('manager'))).toEqual([
      form.message('permissions.userRole.refusal.level'),
    ]);

    fireEvent.keyDown(option('manager'), { key: 'Enter' });
    fireEvent.keyDown(option('manager'), { key: ' ' });
    await settled();

    expect(screen.queryByTestId('role-change-confirm-dialog')).toBeNull();
    expect(onRoleChange.mock.calls).toEqual([]);
  });
});
