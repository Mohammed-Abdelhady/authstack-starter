// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode, ROLE_PERMISSIONS } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import RolesPage from '@/app/[locale]/(dashboard)/admin/roles/page';
import { availability, IDLE, unreachable } from '@/tests/busyControls';
import { isOnScreen, isOpen } from '@/tests/dialogBusy';
import { listedRole } from '@/tests/roleList';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { storeSignedInAs } from '@/tests/signedIn';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const ROLES = [
  { ...listedRole('editor', 'Editor'), permissions: ['users:read:all'] },
  { ...listedRole('writer', 'Writer'), permissions: ['users:read:all'] },
];

type Answer = () => Response;

/** The roles page. Each kind of request answers as `server` says now. */
async function renderPage(locale: AppLocale, firstList?: Answer) {
  const listed: Answer = () => success({ roles: ROLES, total: 2, page: 1, pages: 1 });
  const server: { list: Answer; change: Answer } = {
    list: firstList ?? listed,
    change: () => success(ROLES[0]),
  };
  const requests = stubNetwork((request) =>
    request.method === 'GET' ? server.list() : server.change(),
  );
  const page = await renderForm(
    locale,
    <RolesPage />,
    storeSignedInAs('admin', Object.values(ROLE_PERMISSIONS)),
  );
  return { ...page, server, requests, listed };
}

/** jsdom has no layout, so the observer a checked Radix checkbox asks for never fires. */
class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

registerFormTestLifecycle();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the roles page when a read of the list fails in %s', (locale) => {
  it('says what failed and why in the page language when the first load fails, then recovers', async () => {
    const page = await renderPage(locale, () => refusalWith(500, ErrorCode.INTERNAL_ERROR));

    const retry = await screen.findByTestId('retry-roles-button');
    await waitFor(() => expect(isOnScreen(retry)).toBe(true));
    expect(screen.getByTestId('error-state').textContent).toBe(
      `${page.message('roles.loadError')} ${page.message('errors.codes.INTERNAL_ERROR')}${page.message('common.retry')}`,
    );
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(document.body.textContent).not.toContain(page.message('common.loading'));

    page.server.list = page.listed;
    retry.focus();
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByTestId('role-detail-name').textContent).toBe('Editor'));
    const title = screen.getByRole('heading', { level: 1, name: page.message('roles.title') });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('keeps the list and the open edit dialog when a save and the re-read both fail', async () => {
    const page = await renderPage(locale);
    await waitFor(() => expect(screen.getByTestId('role-detail-name').textContent).toBe('Editor'));
    fireEvent.click(screen.getByTestId('edit-role-button'));
    const name = await screen.findByTestId('edit-role-name-input');
    fireEvent.change(name, { target: { value: 'Night Desk' } });
    page.server.change = unreachable;
    page.server.list = unreachable;

    fireEvent.click(screen.getByRole('button', { name: page.message('roles.form.update') }));

    const reason = await screen.findByTestId('edit-role-error');
    expect(reason.textContent).toBe(page.message('toast.error.networkError'));
    // A save whose answer was lost may have landed, so the list is read again.
    const notice = await screen.findByTestId('stale-list-notice');
    expect(notice.textContent).toBe(
      `${page.message('common.refreshFailed')} ${page.message('toast.error.networkError')}${page.message('common.retry')}`,
    );
    await waitFor(() => expect(availability(name)).toEqual(IDLE));
    await settled();
    expect(isOpen('edit-role-dialog')).toBe(true);
    expect(isOnScreen(screen.getByTestId('role-nav-item-editor'))).toBe(true);
    expect(isOnScreen(screen.queryByTestId('error-state'))).toBe(false);
    expect(name).toHaveProperty('value', 'Night Desk');
  });
});
