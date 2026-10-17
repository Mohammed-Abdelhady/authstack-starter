// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode, ROLE_PERMISSIONS } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import RolesPage from '@/app/[locale]/(dashboard)/admin/roles/page';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import { availability, heldAnswer, HELD, IDLE, unreachable } from '@/tests/busyControls';
import {
  makeStore,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

function role(slug: string, name: string) {
  return {
    version: 0,
    id: `role-${slug}`,
    slug,
    name,
    level: 1,
    permissions: ['users:read:all'],
    isSystemRole: false,
    isProtected: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

const ENDINGS = {
  refused: () => refusalWith(400, ErrorCode.ROLE_HAS_USERS),
  unreachable,
} as const;

/**
 * The roles page with two custom roles, the first selected. A delete is held
 * until settled, and once accepted the list holds the second role alone, so
 * the panel and its delete button then stand for that one.
 */
async function renderPage(locale: AppLocale) {
  const held = heldAnswer();
  let roles = [role('editor', 'Editor'), role('writer', 'Writer')];
  stubNetwork((request) => {
    if (request.method === 'GET') {
      return success({ roles, total: roles.length, page: 1, pages: 1 });
    }
    return held.answer.then((response) => {
      if (response.ok) roles = roles.slice(1);
      return response;
    });
  });
  const store = makeStore();
  store.dispatch(
    loginFulfilled({
      id: 'actor-admin',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      permissions: Object.values(ROLE_PERMISSIONS),
    }),
  );
  const page = await renderForm(locale, <RolesPage />, store);
  await waitFor(() => expect(screen.getByTestId('role-detail-name').textContent).toBe('Editor'));
  return {
    ...page,
    title: screen.getByRole('heading', { level: 1, name: page.message('roles.title') }),
    deleteButton: screen.getByTestId('delete-role-button'),
    accept: () => held.settle(() => success({})),
    settle: held.settle,
  };
}

/** Opens the delete dialog from the panel's button and presses its confirm button. */
async function confirmDelete(deleteButton: HTMLElement) {
  deleteButton.focus();
  fireEvent.click(deleteButton);
  const dialog = await screen.findByTestId('delete-role-dialog');
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  const confirm = screen
    .getAllByTestId('delete-role-button')
    .find((button) => dialog.contains(button));
  if (!confirm) throw new Error('the dialog has no confirm button');
  confirm.focus();
  fireEvent.click(confirm);
  return { dialog, confirm };
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus after a role is deleted in %s', (locale) => {
  it('goes to the page heading, not to the delete button that now stands for another role', async () => {
    const page = await renderPage(locale);
    const { dialog, confirm } = await confirmDelete(page.deleteButton);
    await waitFor(() => expect(availability(confirm)).toEqual(HELD));
    expect(document.activeElement).toBe(confirm);

    page.accept();

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(page.title));
    await waitFor(() => expect(screen.getByTestId('role-detail-name').textContent).toBe('Writer'));
    await settled();
    expect(document.activeElement).toBe(page.title);
  });

  it.each(['refused', 'unreachable'] as const)(
    'stays on the confirm button when the delete is %s, and Escape then returns to the panel',
    async (ending) => {
      const page = await renderPage(locale);
      const { dialog, confirm } = await confirmDelete(page.deleteButton);
      await waitFor(() => expect(availability(confirm)).toEqual(HELD));

      page.settle(ENDINGS[ending]);

      await waitFor(() => expect(availability(confirm)).toEqual(IDLE));
      await settled();
      expect(document.activeElement).toBe(confirm);

      fireEvent.keyDown(dialog, { key: 'Escape' });

      await waitFor(() => expect(document.activeElement).toBe(page.deleteButton));
    },
  );
});
