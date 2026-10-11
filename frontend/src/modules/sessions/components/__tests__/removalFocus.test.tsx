// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import SessionsPage from '@/app/[locale]/(dashboard)/sessions/page';
import { availability, heldAnswer, HELD, IDLE, unreachable } from '@/tests/busyControls';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function session(id: string, isCurrent: boolean) {
  return {
    id,
    userAgent: CHROME_ON_MAC,
    ip: '203.0.113.10',
    deviceName: 'Chrome 120 on macOS 10.15',
    createdAt: '2026-10-01T12:00:00.000Z',
    lastUsedAt: '2026-10-02T11:00:00.000Z',
    isCurrent,
    credentialPurpose: 'browser_session',
  };
}

const ENDINGS = {
  refused: () => refusalWith(500, ErrorCode.INTERNAL_ERROR),
  unreachable,
} as const;

/**
 * The page with this session and one other. A sign-out is held until settled,
 * and once one is accepted the list holds this session alone.
 */
async function renderPage(locale: AppLocale) {
  const held = heldAnswer();
  let others = [session('other', false)];
  stubNetwork((request) => {
    if (request.method === 'GET') {
      const sessions = [session('current', true), ...others];
      return success({ sessions, total: sessions.length });
    }
    return held.answer.then((response) => {
      if (response.ok) others = [];
      return response;
    });
  });
  const page = await renderForm(locale, <SessionsPage />);
  const card = await screen.findByTestId('session-card-timeline-other');
  const title = screen.getByRole('heading', { level: 1, name: page.message('sessions.title') });
  return {
    ...page,
    title,
    signOutButton: within(card).getByTestId('logout-session-button'),
    accept: () => held.settle(() => success({ message: 'done', revokedCount: 1 })),
    settle: held.settle,
  };
}

/** Focuses a button and presses it, then waits for the confirmation it opens to hold focus. */
async function openConfirmation(opener: HTMLElement, dialogId: string) {
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByTestId(dialogId);
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return dialog;
}

/** Presses the confirm button with focus on it, as the keyboard does. */
function confirm(buttonId: string) {
  const button = screen.getByTestId(buttonId);
  button.focus();
  fireEvent.click(button);
  return button;
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus after signing sessions out in %s', (locale) => {
  describe.each([
    ['one session', 'logout-session-confirm-dialog', 'confirm-logout-button'],
    ['every other session', 'revoke-all-confirm-dialog', 'confirm-logout-all'],
  ] as const)('%s', (what, dialogId, confirmId) => {
    const opener = (page: Awaited<ReturnType<typeof renderPage>>) =>
      what === 'one session'
        ? page.signOutButton
        : screen.getByTestId('logout-all-sessions-button');

    it('goes to the page heading once the sign-out is accepted and its button is gone', async () => {
      const page = await renderPage(locale);
      await openConfirmation(opener(page), dialogId);

      const button = confirm(confirmId);

      await waitFor(() => expect(availability(button)).toEqual(HELD));
      expect(screen.queryByTestId(dialogId)).not.toBeNull();
      expect(document.activeElement).toBe(button);

      page.accept();

      await waitFor(() => expect(screen.queryByTestId(dialogId)).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(page.title));
      await waitFor(() => expect(screen.queryByTestId('session-card-timeline-other')).toBeNull());
      await settled();
      expect(document.activeElement).toBe(page.title);
      expect(screen.queryByTestId('logout-all-sessions-button')).toBeNull();
    });

    it.each(['refused', 'unreachable'] as const)(
      'stays on the confirm button, in the open confirmation, when the sign-out is %s',
      async (ending) => {
        const page = await renderPage(locale);
        const dialog = await openConfirmation(opener(page), dialogId);
        const button = confirm(confirmId);
        await waitFor(() => expect(availability(button)).toEqual(HELD));

        page.settle(ENDINGS[ending]);

        await waitFor(() => expect(availability(button)).toEqual(IDLE));
        await settled();
        expect(document.activeElement).toBe(button);

        fireEvent.keyDown(dialog, { key: 'Escape' });

        await waitFor(() => expect(document.activeElement).toBe(opener(page)));
      },
    );

    it('returns to the button that opened the confirmation when it is cancelled', async () => {
      const page = await renderPage(locale);
      const dialog = await openConfirmation(opener(page), dialogId);

      fireEvent.keyDown(dialog, { key: 'Escape' });

      await waitFor(() => expect(screen.queryByTestId(dialogId)).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(opener(page)));
    });
  });
});
