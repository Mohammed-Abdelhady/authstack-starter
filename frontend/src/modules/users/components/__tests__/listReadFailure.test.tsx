// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode, USER_PERMISSIONS } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import UsersPage from '@/app/[locale]/(dashboard)/admin/users/page';
import { pressKey } from '@/modules/permissions/components/users/__tests__/keystroke';
import {
  settledConfirmation,
  stubListLayout,
} from '@/modules/permissions/components/users/__tests__/roleSelectorHarness';
import { availability, IDLE, unreachable } from '@/tests/busyControls';
import { isOnScreen, isOpen } from '@/tests/dialogBusy';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ADMIN_LISTED, storeSignedInAs } from '@/tests/signedIn';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const USER = {
  id: 'user-7',
  name: 'Omar Nasser',
  email: 'omar@example.com',
  role: 'editor',
  isVerified: true,
  isDeleted: false,
  createdAt: '2026-10-01T12:00:00.000Z',
};

function role(slug: string, name: string) {
  return { ...ADMIN_LISTED, id: `role-${slug}`, slug, name, level: 1, isProtected: false };
}
const ROLES = [ADMIN_LISTED, role('editor', 'Editor'), role('writer', 'Writer')];

const USERS = {
  data: [USER],
  pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
};

type Answer = () => Response;

/** The users page with one editor. Each kind of request answers as `server` says now. */
async function renderPage(locale: AppLocale, firstList: Answer = () => success(USERS)) {
  const server: { list: Answer; change: Answer } = {
    list: firstList,
    change: () => success({ id: USER.id, role: 'writer' }),
  };
  const requests = stubNetwork((request, path) => {
    if (request.method !== 'GET') return server.change();
    if (path === '/api/roles') {
      return success({ roles: ROLES, total: ROLES.length, page: 1, pages: 1 });
    }
    return server.list();
  });
  const page = await renderForm(
    locale,
    <UsersPage />,
    storeSignedInAs('admin', Object.values(USER_PERMISSIONS)),
  );
  return { ...page, server, requests };
}

/** Chooses "Writer" for the editor by keyboard and confirms the change with Enter. */
async function confirmRoleChange() {
  const selector = await screen.findByTestId('user-role-selector-user-7');
  await waitFor(() => expect(selector.matches(':disabled')).toBe(false));
  selector.focus();
  fireEvent.keyDown(selector, { key: 'Enter' });
  (await screen.findByRole('option', { name: 'Writer' })).focus();
  pressKey('Enter');
  await settledConfirmation('role-change-confirm-dialog');
  const confirm = screen.getByTestId('confirm-role-change-button');
  confirm.focus();
  pressKey('Enter');
  return confirm;
}

const listReads = (requests: string[]) =>
  requests.filter((entry) => entry === 'GET /api/admin/users').length;
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the users page when a read of the list fails in %s', (locale) => {
  it('keeps the list, the open confirmation and its reason when a change and the re-read both fail', async () => {
    const page = await renderPage(locale);
    await screen.findByTestId('user-role-selector-user-7');
    page.server.change = unreachable;
    page.server.list = unreachable;

    const confirm = await confirmRoleChange();

    const reason = await screen.findByTestId('role-change-error');
    expect(reason.textContent).toBe(page.message('toast.error.networkError'));
    // The outcome of a change whose answer was lost is unknown, so the list is read again.
    await waitFor(() => expect(listReads(page.requests)).toBe(2));
    const notice = await screen.findByTestId('stale-list-notice');
    expect(notice.textContent).toBe(
      `${page.message('common.refreshFailed')} ${page.message('toast.error.networkError')}${page.message('common.retry')}`,
    );
    await waitFor(() => expect(availability(confirm)).toEqual(IDLE));
    await settled();
    expect(isOpen('role-change-confirm-dialog')).toBe(true);
    expect(document.activeElement).toBe(confirm);
    expect(isOnScreen(screen.getByTestId('user-role-selector-user-7'))).toBe(true);
    expect(isOnScreen(screen.queryByTestId('error-state'))).toBe(false);
  });

  it('does not read the list again after a change the server refused', async () => {
    const page = await renderPage(locale);
    await screen.findByTestId('user-role-selector-user-7');
    page.server.change = () => refusalWith(403, ErrorCode.CANNOT_MODIFY_HIGHER_ROLE);

    await confirmRoleChange();

    await screen.findByTestId('role-change-error');
    await settled();
    expect(listReads(page.requests)).toBe(1);
    expect(screen.queryByTestId('stale-list-notice')).toBeNull();
  });

  it('takes the notice down once Retry read the list again', async () => {
    const page = await renderPage(locale);
    await screen.findByTestId('user-role-selector-user-7');
    page.server.list = unreachable;
    fireEvent.click(screen.getByTestId('refresh-users-button'));
    const retry = await screen.findByTestId('retry-refresh-users-button');
    await waitFor(() => expect(availability(retry)).toEqual(IDLE));

    page.server.list = () => success(USERS);
    retry.focus();
    fireEvent.click(retry);

    await waitFor(() => expect(screen.queryByTestId('stale-list-notice')).toBeNull());
    const title = screen.getByRole('heading', { level: 1, name: page.message('users.title') });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('replaces the list with the failure, in the page language, when the first load fails', async () => {
    const page = await renderPage(locale, () => refusalWith(500, ErrorCode.INTERNAL_ERROR));

    const retry = await screen.findByTestId('retry-users-button');
    await waitFor(() => expect(isOnScreen(retry)).toBe(true));
    expect(screen.getByTestId('error-state').textContent).toBe(
      `${page.message('users.loadError')} ${page.message('errors.codes.INTERNAL_ERROR')}${page.message('common.retry')}`,
    );
    expect(screen.queryByTestId('stale-list-notice')).toBeNull();
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });
});
