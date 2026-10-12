// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { adminContext, TARGET_USER } from './adminEmailConfirmationHarness';
import {
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { listedRole } from '@/tests/roleList';
import { UserCard, type User } from '../UserCard';
import { pressKey } from './keystroke';
import { CONFIRM_DIALOG, settledConfirmation, stubListLayout } from './roleSelectorHarness';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const CARD_USER: User = { ...TARGET_USER, _id: 'user-focus-1', role: 'editor' };
const SELECTOR = `user-role-selector-${CARD_USER._id}`;
const ROLE_REGION = 'user-card-role-region';
const UNRELATED_INPUT = 'unrelated-input';
const ROLES = [
  { ...listedRole('user', 'User', 1), isSystemRole: true, isProtected: true },
  listedRole('editor', 'Editor', 2),
  { ...listedRole('admin', 'Admin', 4), isSystemRole: true, isProtected: true },
];

function roleResponse() {
  return success({ roles: ROLES, total: ROLES.length, page: 1, pages: 1 });
}

function updateResponse(role: string) {
  return success({
    id: CARD_USER._id,
    name: CARD_USER.name,
    email: CARD_USER.email,
    role,
    isVerified: CARD_USER.isVerified,
    isDeleted: CARD_USER.isDeleted,
    createdAt: CARD_USER.createdAt,
  });
}

async function renderCard(
  locale: AppLocale,
  respond: (request: Request, path: string) => Response,
) {
  stubNetwork((request, path) =>
    request.method === 'GET' && path === '/api/roles' ? roleResponse() : respond(request, path),
  );
  const context = await adminContext(locale);
  const view = render(
    <>
      <input data-testid={UNRELATED_INPUT} />
      <UserCard user={CARD_USER} />
    </>,
    { wrapper: context.wrapper },
  );
  await waitFor(() => expect(screen.getByTestId(SELECTOR).matches(':disabled')).toBe(false));
  return {
    context,
    rerenderUser: (user: User) =>
      view.rerender(
        <>
          <input data-testid={UNRELATED_INPUT} />
          <UserCard user={user} />
        </>,
      ),
  };
}

async function confirmUserRoleChange() {
  const selector = screen.getByTestId(SELECTOR);
  selector.focus();
  fireEvent.keyDown(selector, { key: 'Enter' });
  (await screen.findByTestId('role-option-user')).focus();
  pressKey('Enter');
  await settledConfirmation(CONFIRM_DIALOG);
  screen.getByTestId('confirm-role-change-button').focus();
  pressKey('Enter');
}

beforeAll(stubListLayout);

registerFormTestLifecycle();

describe.each(['en', 'ar'] as const)('role-card focus ownership in %s', (locale) => {
  it.each(['user', 'admin'] as const)(
    'preserves unrelated focus when a refreshed role becomes %s',
    async (role) => {
      const card = await renderCard(locale, () => roleResponse());
      const input = screen.getByTestId(UNRELATED_INPUT);
      input.focus();

      card.rerenderUser({ ...CARD_USER, role });

      await waitFor(() => expect(screen.queryByTestId(SELECTOR)).toBeNull());
      expect(document.activeElement).toBe(input);
    },
  );

  it('does not claim document-body focus for a background role refresh', async () => {
    const card = await renderCard(locale, () => roleResponse());
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    expect(document.activeElement).toBe(document.body);

    card.rerenderUser({ ...CARD_USER, role: 'user' });

    await waitFor(() => expect(screen.queryByTestId(SELECTOR)).toBeNull());
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the role region after its confirmed change removes the selector', async () => {
    const card = await renderCard(locale, (_request, path) =>
      path === `/api/admin/users/${CARD_USER._id}/role` ? updateResponse('user') : roleResponse(),
    );

    await confirmUserRoleChange();
    await waitFor(() => expect(screen.queryByTestId(CONFIRM_DIALOG)).toBeNull());
    card.rerenderUser({ ...CARD_USER, role: 'user' });

    await waitFor(() => expect(screen.queryByTestId(SELECTOR)).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId(ROLE_REGION));
  });

  it('does not carry refused intent into a later background refresh', async () => {
    const card = await renderCard(locale, () => refusalWith(500, ErrorCode.INTERNAL_ERROR));

    await confirmUserRoleChange();
    await waitFor(() => expect(screen.getByTestId('role-change-error')).toBeTruthy());
    fireEvent.keyDown(screen.getByTestId(CONFIRM_DIALOG), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId(CONFIRM_DIALOG)).toBeNull());

    const input = screen.getByTestId(UNRELATED_INPUT);
    input.focus();
    card.rerenderUser({ ...CARD_USER, role: 'user' });

    await waitFor(() => expect(screen.queryByTestId(SELECTOR)).toBeNull());
    expect(document.activeElement).toBe(input);
  });
});
