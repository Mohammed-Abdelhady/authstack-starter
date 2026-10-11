// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { availability, heldAnswer, HELD, IDLE, unreachable } from '@/tests/busyControls';
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
type Ending = keyof typeof ENDINGS;

const focusedId = () => document.activeElement?.getAttribute('data-testid') ?? null;

/** The card of an editor, with the role list loaded and every change held until settled. */
async function renderCard(locale: AppLocale) {
  const held = heldAnswer();
  const requests = stubNetwork((request) =>
    request.method === 'GET'
      ? success({ roles: ROLES, total: ROLES.length, page: 1, pages: 1 })
      : held.answer,
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

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus on a user card while a confirmed change runs in %s', (locale) => {
  it.each(['accepted', 'refused', 'unreachable'] as const)(
    'stays on the role selector during a role change and after it is %s',
    async (ending: Ending) => {
      const { selector, settle, requests } = await renderCard(locale);

      await confirmRoleChange(selector);

      await waitFor(() => expect(screen.queryByTestId('role-change-confirm-dialog')).toBeNull());
      await waitFor(() => expect(focusedId()).toBe(SELECTOR));
      expect(availability(selector)).toEqual(HELD);
      expect(selector.getAttribute('aria-busy')).toBe('true');
      expect(availability(screen.getByTestId(MENU_BUTTON))).toEqual(HELD);
      expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([
        'PATCH /api/admin/users/user-7/role',
      ]);

      settle(ENDINGS[ending]);

      await waitFor(() => expect(availability(selector)).toEqual(IDLE));
      await settled();
      expect(focusedId()).toBe(SELECTOR);
      expect(selector.getAttribute('aria-busy')).toBe('false');
    },
  );

  it.each(['accepted', 'refused', 'unreachable'] as const)(
    'stays on the actions button during a deactivation and after it is %s',
    async (ending: Ending) => {
      const { settle, requests } = await renderCard(locale);
      const menuButton = screen.getByTestId(MENU_BUTTON);

      await confirmDeactivation();

      await waitFor(() => expect(screen.queryByTestId('user-action-confirm-dialog')).toBeNull());
      await waitFor(() => expect(focusedId()).toBe(MENU_BUTTON));
      expect(availability(menuButton)).toEqual(HELD);
      expect(menuButton.getAttribute('aria-busy')).toBe('true');
      expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([
        'PATCH /api/admin/users/user-7/status',
      ]);

      settle(ENDINGS[ending]);

      await waitFor(() => expect(availability(menuButton)).toEqual(IDLE));
      await settled();
      expect(focusedId()).toBe(MENU_BUTTON);
    },
  );

  it('does not open the actions menu or the role list while a role change runs', async () => {
    const { selector, settle } = await renderCard(locale);
    await confirmRoleChange(selector);
    await waitFor(() => expect(availability(selector)).toEqual(HELD));

    fireEvent.keyDown(screen.getByTestId(MENU_BUTTON), { key: 'Enter' });
    fireEvent.keyDown(selector, { key: 'Enter' });

    await settled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    settle(ENDINGS.accepted);
    await waitFor(() => expect(availability(selector)).toEqual(IDLE));
  });
});
