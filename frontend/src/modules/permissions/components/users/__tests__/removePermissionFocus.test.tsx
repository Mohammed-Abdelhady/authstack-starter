// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { expectFocusKeptThroughRequest, heldAnswer, unreachable } from '@/tests/busyControls';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { UserPermissionsDialog } from '../UserPermissionsDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const DIRECT = 'reports:read:all';
const REMOVE_BUTTON = `remove-permission-${DIRECT}`;

const ENDINGS = {
  refused: () => refusalWith(403, ErrorCode.CANNOT_MODIFY_HIGHER_ROLE),
  unreachable,
} as const;

/**
 * The dialog of a user with one direct permission. Its removal is held until
 * settled, and once accepted the user has no direct permission left.
 */
async function renderDialog(locale: AppLocale) {
  const held = heldAnswer();
  let direct = [DIRECT];
  stubNetwork((request, path) => {
    if (request.method === 'DELETE') {
      return held.answer.then((response) => {
        if (response.ok) direct = [];
        return response;
      });
    }
    return path.endsWith('/permissions')
      ? success({ userId: 'user-7', role: 'editor', permissions: direct })
      : success({ id: 'role-editor', slug: 'editor', name: 'Editor', permissions: [] });
  });
  const dialog = await renderForm(
    locale,
    <UserPermissionsDialog open onOpenChange={vi.fn()} userId="user-7" />,
  );
  const remove = await screen.findByTestId(REMOVE_BUTTON);
  return {
    ...dialog,
    remove,
    heading: (count: number) =>
      screen.getByRole('heading', {
        name: dialog.format('permissions.dialog.directPermissions', { count }),
      }),
    accept: () => held.settle(() => success({ userId: 'user-7', permissions: [] })),
    settle: held.settle,
  };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus after a direct permission is removed in %s', (locale) => {
  it('goes to the heading of the direct permissions once the row and its button are gone', async () => {
    const dialog = await renderDialog(locale);
    expect(
      screen.getByRole('button', {
        name: dialog.format('permissions.dialog.removePermission', { permission: DIRECT }),
      }),
    ).toBe(dialog.remove);
    dialog.remove.focus();

    fireEvent.click(dialog.remove);
    dialog.accept();

    await waitFor(() => expect(screen.queryByTestId(REMOVE_BUTTON)).toBeNull());
    expect(document.activeElement).toBe(dialog.heading(0));
  });

  it.each(['refused', 'unreachable'] as const)(
    'stays on the remove button when the removal is %s',
    async (ending) => {
      const dialog = await renderDialog(locale);
      dialog.remove.focus();

      fireEvent.click(dialog.remove);

      await expectFocusKeptThroughRequest(dialog.remove, () => dialog.settle(ENDINGS[ending]));
    },
  );
});
