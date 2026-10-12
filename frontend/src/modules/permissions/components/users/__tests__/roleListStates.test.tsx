// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { RoleFilter } from '@/modules/users/components/RoleFilter';
import { unreachable } from '@/tests/busyControls';
import { listedRole, manyRoles, rolesPage } from '@/tests/roleList';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
} from '@/tests/serverRejectionHarness';
import { ADMIN_LISTED, storeSignedInAs } from '@/tests/signedIn';
import { CreateUserDialog } from '../CreateUserDialog';
import { UserRoleLabel } from '../UserRoleLabel';
import { UserRoleSelector } from '../UserRoleSelector';
import { stubListLayout } from './roleSelectorHarness';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

/** Three pages of roles: the admin role, then "Role 1" to "Role 249". */
const THREE_PAGES = [ADMIN_LISTED, ...manyRoles(249)];
const LAST = { slug: 'role-249', name: 'Role 249' };

const FAILURES = {
  refused: () => refusalWith(500, ErrorCode.INTERNAL_ERROR),
  unreachable,
} as const;

/** Serves `roles`, failing the second page while `failing` says so. */
function serveRoles(roles: readonly object[], failing: () => (() => Response) | null = () => null) {
  return stubNetwork((request) => {
    const failure = failing();
    const isSecondPage = new URL(request.url).searchParams.get('page') === '2';
    return failure && isSecondPage ? failure() : rolesPage(request, roles);
  });
}

async function renderAsAdmin(locale: AppLocale, page: React.ReactElement) {
  return renderForm(locale, page, storeSignedInAs('admin'));
}

const selectorName = (form: Awaited<ReturnType<typeof renderForm>>, role: string) =>
  form.format('permissions.userRole.selectorLabel', { role });

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('role selectors and a role list of three pages in %s', (locale) => {
  it('names a role from the last page on a card and offers every role in its list', async () => {
    serveRoles(THREE_PAGES);
    const form = await renderAsAdmin(
      locale,
      <UserRoleSelector userId="user-1" currentRole={LAST.slug} />,
    );

    const trigger = await screen.findByRole('combobox', { name: selectorName(form, LAST.name) });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const options = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(options.length).toBe(250);
    expect(options.at(-1)?.textContent).toBe(LAST.name);
  });

  it('offers a role from the last page in the create user dialog', async () => {
    serveRoles(THREE_PAGES);
    const form = await renderAsAdmin(locale, <CreateUserDialog open onOpenChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox', { name: form.message('users.createUser.role') });
    await waitFor(() => expect(trigger.matches(':disabled')).toBe(false));

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const lastOption = await screen.findByTestId(`role-option-${LAST.slug}`);
    expect(lastOption.textContent).toBe(LAST.name);
    fireEvent.keyDown(lastOption, { key: 'Enter' });

    await waitFor(() => expect(trigger.textContent).toBe(LAST.name));
  });

  it('names a role from the last page where the role is read-only text', async () => {
    serveRoles(THREE_PAGES);
    await renderAsAdmin(locale, <UserRoleLabel slug={LAST.slug} />);

    await waitFor(() => expect(screen.getByTestId('user-card-role').textContent).toBe(LAST.name));
  });

  it('names a role from the last page on the filter that was given only its slug', async () => {
    serveRoles(THREE_PAGES);
    await renderAsAdmin(locale, <RoleFilter value={LAST.slug} onChange={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId('role-filter-value').textContent).toBe(LAST.name),
    );
  });

  it('reads the list once for every selector, label and filter on the page', async () => {
    const requests = serveRoles(THREE_PAGES);
    await renderAsAdmin(
      locale,
      <>
        <UserRoleSelector userId="user-1" currentRole="role-1" />
        <UserRoleSelector userId="user-2" currentRole={LAST.slug} />
        <UserRoleLabel slug="role-2" />
        <RoleFilter value="role-3" onChange={vi.fn()} />
        <CreateUserDialog open onOpenChange={vi.fn()} />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('user-card-role').textContent).toBe('Role 2'));
    expect(requests).toEqual(['GET /api/roles', 'GET /api/roles', 'GET /api/roles']);
  });

  it('moves to the role that starts with a typed letter in the open list', async () => {
    serveRoles([ADMIN_LISTED, listedRole('editor', 'Editor'), listedRole('writer', 'Writer')]);
    const form = await renderAsAdmin(
      locale,
      <UserRoleSelector userId="user-1" currentRole="editor" />,
    );
    const trigger = await screen.findByRole('combobox', { name: selectorName(form, 'Editor') });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const list = await screen.findByRole('listbox');

    fireEvent.keyDown(list, { key: 'w' });

    await waitFor(() =>
      expect(document.activeElement).toBe(within(list).getByRole('option', { name: 'Writer' })),
    );
  });

  it('shows the slug, and still every other role, for a role that has since been deleted', async () => {
    serveRoles([ADMIN_LISTED, listedRole('editor', 'Editor')]);
    const form = await renderAsAdmin(
      locale,
      <UserRoleSelector userId="user-1" currentRole="night-shift" />,
    );

    const trigger = await screen.findByRole('combobox', {
      name: selectorName(form, 'night-shift'),
    });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const names = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.getAttribute('data-testid'));
    expect(names).toEqual(['role-option-admin', 'role-option-editor']);
  });

  it('opens an empty list, with the slug on the trigger, when there is no role at all', async () => {
    serveRoles([]);
    const form = await renderAsAdmin(
      locale,
      <UserRoleSelector userId="user-1" currentRole="editor" />,
    );

    const trigger = await screen.findByRole('combobox', { name: selectorName(form, 'editor') });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(within(await screen.findByRole('listbox')).queryAllByRole('option')).toEqual([]);
  });

  describe.each(['refused', 'unreachable'] as const)('when a page of the list is %s', (failure) => {
    it('shows a card that the roles could not be read, with the slug and a retry that works', async () => {
      let failing = true;
      serveRoles(THREE_PAGES, () => (failing ? FAILURES[failure] : null));
      const form = await renderAsAdmin(
        locale,
        <UserRoleSelector userId="user-1" currentRole={LAST.slug} />,
      );

      const error = await screen.findByTestId('user-role-list-error-user-1');
      expect(error.textContent).toContain(form.message('users.roleFilterError'));
      expect(screen.getByTestId('user-role-unavailable-user-1').textContent).toContain(LAST.slug);
      expect(screen.queryByRole('combobox')).toBeNull();

      failing = false;
      fireEvent.click(within(error).getByRole('button', { name: form.message('common.retry') }));

      expect(
        await screen.findByRole('combobox', { name: selectorName(form, LAST.name) }),
      ).not.toBeNull();
      expect(screen.queryByTestId('user-role-list-error-user-1')).toBeNull();
    });

    it('says so in the create user dialog, holds the submit back, and recovers on retry', async () => {
      let failing = true;
      serveRoles(THREE_PAGES, () => (failing ? FAILURES[failure] : null));
      const form = await renderAsAdmin(locale, <CreateUserDialog open onOpenChange={vi.fn()} />);

      const error = await screen.findByRole('alert');
      expect(error.textContent).toContain(form.message('users.roleFilterError'));
      expect(screen.queryByTestId('create-user-role-select')).toBeNull();
      expect(screen.getByTestId('submit-create-user-button').matches(':disabled')).toBe(true);

      failing = false;
      fireEvent.click(within(error).getByRole('button', { name: form.message('common.retry') }));

      const trigger = await screen.findByTestId('create-user-role-select');
      await waitFor(() => expect(trigger.matches(':disabled')).toBe(false));
      expect(screen.getByTestId('submit-create-user-button').matches(':disabled')).toBe(false);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('leaves the slug where the role is read-only text', async () => {
      const requests = serveRoles(THREE_PAGES, () => FAILURES[failure]);
      await renderAsAdmin(locale, <UserRoleLabel slug={LAST.slug} />);

      await waitFor(() => expect(requests.length).toBe(2));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(screen.getByTestId('user-card-role').textContent).toBe(LAST.slug);
    });
  });
});
