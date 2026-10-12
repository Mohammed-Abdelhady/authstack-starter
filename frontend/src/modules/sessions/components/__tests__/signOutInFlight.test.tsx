// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import SessionsPage from '@/app/[locale]/(dashboard)/sessions/page';
import { availability, heldAnswer, HELD, IDLE, unreachable } from '@/tests/busyControls';
import { askToClose, isOnScreen, isOpen } from '@/tests/dialogBusy';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function session(id: string, deviceName: string, isCurrent = false) {
  return {
    id,
    userAgent: USER_AGENT,
    ip: '203.0.113.10',
    deviceName,
    createdAt: '2026-10-01T12:00:00.000Z',
    lastUsedAt: '2026-10-02T11:00:00.000Z',
    isCurrent,
    credentialPurpose: 'browser_session',
  };
}

const CURRENT = session('current', 'Chrome 152 on macOS 10.15', true);
const FIREFOX = session('firefox', 'Firefox 130 on Linux');
const SAFARI = session('safari', 'Safari 18 on iOS 18');

const ONE = { dialog: 'logout-session-confirm-dialog', confirm: 'confirm-logout-button' } as const;
const ALL = { dialog: 'revoke-all-confirm-dialog', confirm: 'confirm-logout-all' } as const;

/**
 * The page with this session, Firefox and Safari. A sign-out is held until
 * settled. `page.list` is what the next read of the list answers, or
 * `unreachable`.
 */
async function renderPage(locale: AppLocale) {
  const held = heldAnswer();
  const server = { list: [CURRENT, FIREFOX, SAFARI] as unknown[] | typeof unreachable };
  const requests = stubNetwork((request) => {
    if (request.method !== 'GET') return held.answer.then((response) => response.clone());
    if (typeof server.list === 'function') return server.list();
    return success({ sessions: server.list, total: server.list.length });
  });
  const page = await renderForm(locale, <SessionsPage />);
  await screen.findByTestId('session-card-timeline-firefox');
  const title = screen.getByRole('heading', { level: 1, name: page.message('sessions.title') });
  return { ...page, title, server, requests, settle: held.settle };
}

/** Opens the confirmation for Firefox and presses its confirm button. */
async function confirmFirefox() {
  const card = screen.getByTestId('session-card-timeline-firefox');
  const opener = within(card).getByTestId('logout-session-button');
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByTestId(ONE.dialog);
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  const confirm = screen.getByTestId(ONE.confirm);
  confirm.focus();
  fireEvent.click(confirm);
  await waitFor(() => expect(availability(confirm)).toEqual(HELD));
  return { dialog, confirm };
}

async function confirmAll() {
  const opener = screen.getByTestId('logout-all-sessions-button');
  opener.focus();
  fireEvent.click(opener);
  await screen.findByTestId(ALL.dialog);
  const confirm = screen.getByTestId(ALL.confirm);
  confirm.focus();
  fireEvent.click(confirm);
  await waitFor(() => expect(availability(confirm)).toEqual(HELD));
  return confirm;
}

const deletes = (requests: string[]) => requests.filter((entry) => !entry.startsWith('GET'));
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a session sign-out in flight in %s', (locale) => {
  it.each([
    ['one session', ONE, confirmFirefox, 'cancel-logout-button'],
    ['every other session', ALL, confirmAll, 'cancel-logout-all'],
  ] as const)(
    'cannot be closed for %s until the answer arrives, and can after a refusal',
    async (_what, ids, confirm, cancelId) => {
      const page = await renderPage(locale);
      await confirm();

      await askToClose(ids.dialog);
      fireEvent.click(screen.getByTestId(cancelId));
      await settled();

      expect(isOpen(ids.dialog)).toBe(true);
      expect(availability(screen.getByTestId(cancelId))).toEqual(HELD);
      expect(deletes(page.requests).length).toBe(1);

      page.settle(() => refusalWith(500, ErrorCode.INTERNAL_ERROR));
      await waitFor(() => expect(availability(screen.getByTestId(cancelId))).toEqual(IDLE));
      await askToClose(ids.dialog);

      await waitFor(() => expect(screen.queryByTestId(ids.dialog)).toBeNull());
    },
  );

  it('still names the session it was opened for when the list is re-ordered, and sends it again', async () => {
    const page = await renderPage(locale);
    const { dialog, confirm } = await confirmFirefox();
    page.server.list = [CURRENT, SAFARI, FIREFOX];

    page.settle(() => refusalWith(500, ErrorCode.INTERNAL_ERROR));

    await waitFor(() => expect(availability(confirm)).toEqual(IDLE));
    await waitFor(() => expect(page.requests.filter((r) => r.startsWith('GET')).length).toBe(2));
    await settled();
    expect(within(dialog).getByTestId('logout-session-device').textContent).toBe(
      'Firefox 130 on Linux',
    );
    expect(within(dialog).getByTestId('logout-session-error').textContent).toBe(
      page.message('errors.codes.INTERNAL_ERROR'),
    );
    expect(page.errorToasts()).toEqual([]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(document.activeElement).toBe(confirm);

    fireEvent.click(confirm);

    await waitFor(() =>
      expect(deletes(page.requests)).toEqual([
        'DELETE /api/user/sessions/firefox',
        'DELETE /api/user/sessions/firefox',
      ]),
    );
  });

  it('says the session has ended, and offers only closing, when it is gone from the list', async () => {
    const page = await renderPage(locale);
    const { dialog } = await confirmFirefox();
    page.server.list = [CURRENT, SAFARI];

    page.settle(() => refusalWith(404, ErrorCode.SESSION_NOT_FOUND));

    const gone = await within(dialog).findByTestId('logout-session-gone');
    expect(gone.textContent).toBe(page.message('sessions.alreadyEnded'));
    expect(within(dialog).getByTestId('logout-session-device').textContent).toBe(
      'Firefox 130 on Linux',
    );
    expect(screen.queryByTestId(ONE.confirm)).toBeNull();
    const close = within(dialog).getByRole('button', { name: page.message('common.close') });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(page.errorToasts()).toEqual([]);

    fireEvent.click(close);

    await waitFor(() => expect(screen.queryByTestId(ONE.dialog)).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(page.title));
    expect(deletes(page.requests)).toEqual(['DELETE /api/user/sessions/firefox']);
  });

  it('keeps the confirmation, its reason and the list when the server cannot be reached at all', async () => {
    const page = await renderPage(locale);
    const { dialog, confirm } = await confirmFirefox();
    page.server.list = unreachable;

    page.settle(unreachable);

    const reason = await within(dialog).findByTestId('logout-session-error');
    expect(reason.textContent).toBe(page.message('toast.error.networkError'));
    // The list is read again after a sign-out that may have happened, and that read fails too.
    const notice = await screen.findByTestId('stale-list-notice');
    expect(notice.textContent).toContain(page.message('common.refreshFailed'));
    await settled();
    expect(isOpen(ONE.dialog)).toBe(true);
    expect(document.activeElement).toBe(confirm);
    expect(isOnScreen(screen.queryByTestId('session-card-timeline-firefox'))).toBe(true);
    expect(isOnScreen(screen.queryByTestId('error-state'))).toBe(false);
  });

  it('shows the reason of a refused sign-out of every other session in the confirmation', async () => {
    const page = await renderPage(locale);
    await confirmAll();

    page.settle(() => refusalWith(403, ErrorCode.FORBIDDEN));

    const reason = await screen.findByTestId('revoke-all-error');
    expect(reason.textContent).toBe(page.message('errors.codes.FORBIDDEN'));
    expect(page.errorToasts()).toEqual([]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it('says why a first load failed in the page language, and moves focus to the title once Retry worked', async () => {
    const server = { reachable: false };
    stubNetwork(() => {
      if (!server.reachable) return refusalWith(500, ErrorCode.INTERNAL_ERROR);
      return success({ sessions: [CURRENT], total: 1 });
    });
    const page = await renderForm(locale, <SessionsPage />);

    const retry = await screen.findByTestId('retry-sessions-button');
    await waitFor(() => expect(isOnScreen(retry)).toBe(true));
    expect(screen.getByTestId('error-state').textContent).toBe(
      `${page.message('sessions.loadError')} ${page.message('errors.codes.INTERNAL_ERROR')}${page.message('common.retry')}`,
    );
    expect(screen.queryByTestId('stale-list-notice')).toBeNull();

    server.reachable = true;
    retry.focus();
    fireEvent.click(retry);

    await screen.findByTestId('session-card-timeline-current');
    const title = screen.getByRole('heading', { level: 1, name: page.message('sessions.title') });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });
});
