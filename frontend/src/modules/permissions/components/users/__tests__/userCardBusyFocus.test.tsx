// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { availability, heldAnswer, HELD, IDLE, unreachable } from '@/tests/busyControls';
import { askToClose, isOpen } from '@/tests/dialogBusy';
import {
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { renderAdminCard } from './adminEmailConfirmationHarness';
import { pressKey } from './keystroke';
import { settledConfirmation, stubListLayout } from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  _id: 'user-7',
  name: 'Omar Nasser',
  email: 'omar@example.com',
  role: 'editor',
  isVerified: true,
  isDeleted: false,
  createdAt: '2026-10-01T12:00:00.000Z',
};
const SELECTOR = 'user-role-selector-user-7';
const MENU_BUTTON = 'user-actions-menu-user-7';

function role(slug: string, name: string, level: number) {
  return {
    id: `role-${slug}`,
    slug,
    name,
    level,
    permissions: [],
    isSystemRole: false,
    isProtected: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}
const ROLES = [role('admin', 'Admin', 4), role('editor', 'Editor', 1), role('writer', 'Writer', 1)];

/** How a held change ends: accepted, refused by the server, or never reaching it. */
const ENDINGS = {
  accepted: () => success({ id: USER._id, role: 'writer', isDeleted: true }),
  refused: () => refusalWith(403, ErrorCode.CANNOT_MODIFY_HIGHER_ROLE),
  unreachable,
} as const;

/** The card of an editor, with the role list loaded and every change held until settled. */
async function renderCard(locale: AppLocale) {
  const held = heldAnswer();
  const requests = stubNetwork((request) =>
    request.method === 'GET'
      ? success({ roles: ROLES, total: ROLES.length, page: 1, pages: 1 })
      : // Each send reads its own copy, so the same answer can refuse a second one.
        held.answer.then((response) => response.clone()),
  );
  const card = await renderAdminCard(locale, USER);
  const selector = await screen.findByTestId(SELECTOR);
  await waitFor(() => expect(selector.matches(':disabled')).toBe(false));
  return { ...card, requests, selector, settle: held.settle };
}

/** Chooses "Writer" by keyboard and confirms the change with Enter. */
async function confirmRoleChange(selector: HTMLElement) {
  selector.focus();
  fireEvent.keyDown(selector, { key: 'Enter' });
  (await screen.findByRole('option', { name: 'Writer' })).focus();
  pressKey('Enter');
  await settledConfirmation('role-change-confirm-dialog');
  screen.getByTestId('confirm-role-change-button').focus();
  pressKey('Enter');
}

/** Opens the actions menu by keyboard, chooses deactivate and confirms with Enter. */
async function confirmDeactivation() {
  const menuButton = screen.getByTestId(MENU_BUTTON);
  menuButton.focus();
  fireEvent.keyDown(menuButton, { key: 'Enter' });
  (await screen.findByTestId('deactivate-user-user-7')).focus();
  pressKey('Enter');
  await settledConfirmation('user-action-confirm-dialog');
  screen.getByTestId('confirm-user-action-button').focus();
  pressKey('Enter');
}

/** Lets a move of focus that follows a change of the page show itself. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeAll(stubListLayout);

registerFormTestLifecycle();

/** What each kind of change is confirmed in, and what opened it. */
const CHANGES = {
  'role change': {
    opener: SELECTOR,
    dialog: 'role-change-confirm-dialog',
    confirm: 'confirm-role-change-button',
    error: 'role-change-error',
    request: 'PATCH /api/admin/users/user-7/role',
  },
  deactivation: {
    opener: MENU_BUTTON,
    dialog: 'user-action-confirm-dialog',
    confirm: 'confirm-user-action-button',
    error: 'user-action-error',
    request: 'PATCH /api/admin/users/user-7/status',
  },
} as const;
type Change = keyof typeof CHANGES;

/** Confirms a change by keyboard and waits until its request is in flight. */
async function confirmed(locale: AppLocale, change: Change) {
  const card = await renderCard(locale);
  if (change === 'role change') await confirmRoleChange(card.selector);
  else await confirmDeactivation();
  const confirm = screen.getByTestId(CHANGES[change].confirm);
  await waitFor(() => expect(availability(confirm)).toEqual(HELD));
  return { ...card, confirm, opener: screen.getByTestId(CHANGES[change].opener) };
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a confirmed change on a user card while its request runs in %s', (locale) => {
  describe.each(['role change', 'deactivation'] as const)('%s', (change) => {
    const { dialog, error, request } = CHANGES[change];

    it('keeps the confirmation open, busy and in focus, and holds the card behind it', async () => {
      const card = await confirmed(locale, change);

      await settled();
      expect(screen.queryByTestId(dialog)).not.toBeNull();
      expect(document.activeElement).toBe(card.confirm);
      expect(card.confirm.getAttribute('aria-busy')).toBe('true');
      expect(availability(card.opener)).toEqual(HELD);
      expect(card.requests.filter((sent) => !sent.startsWith('GET'))).toEqual([request]);

      await askToClose(dialog);
      fireEvent.click(card.confirm);

      await settled();
      expect(isOpen(dialog)).toBe(true);
      expect(card.requests.filter((sent) => !sent.startsWith('GET'))).toEqual([request]);
      card.settle(ENDINGS.accepted);
      await waitFor(() => expect(screen.queryByTestId(dialog)).toBeNull());
    });

    it('closes once the change is accepted and returns focus to what opened it', async () => {
      const card = await confirmed(locale, change);

      card.settle(ENDINGS.accepted);

      await waitFor(() => expect(screen.queryByTestId(dialog)).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(card.opener));
      await waitFor(() => expect(availability(card.opener)).toEqual(IDLE));
      await settled();
      expect(document.activeElement).toBe(card.opener);
    });

    it.each([
      ['refused', 'errors.codes.CANNOT_MODIFY_HIGHER_ROLE'],
      ['unreachable', 'toast.error.networkError'],
    ] as const)(
      'stays open when the change is %s, says why inside, and returns focus when closed',
      async (ending, reason) => {
        const card = await confirmed(locale, change);

        card.settle(ENDINGS[ending]);

        await waitFor(() => expect(availability(card.confirm)).toEqual(IDLE));
        await settled();
        expect(screen.getByTestId(error).textContent).toBe(card.message(reason));
        expect(document.activeElement).toBe(card.confirm);
        expect(card.confirm.getAttribute('aria-busy')).toBe('false');

        fireEvent.keyDown(screen.getByTestId(dialog), { key: 'Escape' });

        await waitFor(() => expect(screen.queryByTestId(dialog)).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(card.opener));
      },
    );

    it('drops the reason of a refusal when the change is sent again', async () => {
      const card = await confirmed(locale, change);
      card.settle(ENDINGS.refused);
      await waitFor(() => expect(screen.queryByTestId(error)).not.toBeNull());
      await waitFor(() => expect(availability(card.confirm)).toEqual(IDLE));

      fireEvent.click(card.confirm);

      await waitFor(() => expect(screen.queryByTestId(error)).toBeNull());
    });
  });

  it('does not open the actions menu or the role list while a role change runs', async () => {
    const card = await confirmed(locale, 'role change');

    fireEvent.keyDown(screen.getByTestId(MENU_BUTTON), { key: 'Enter' });
    fireEvent.keyDown(card.selector, { key: 'Enter' });

    await settled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    card.settle(ENDINGS.accepted);
    await waitFor(() => expect(availability(card.selector)).toEqual(IDLE));
  });
});
