// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import {
  availability,
  HELD,
  IDLE,
  expectFocusKeptThroughRequest,
  heldAnswer,
  unreachable,
} from '@/tests/busyControls';
import { permissionsApi } from '../../../api/permissionsApi';
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
  const reread = heldAnswer();
  let holdReads = false;
  let refuseDeletes = false;
  let deletes = 0;
  let direct = [DIRECT];
  stubNetwork((request, path) => {
    if (request.method === 'DELETE') {
      deletes += 1;
      if (refuseDeletes) return refusalWith(403, ErrorCode.CANNOT_MODIFY_HIGHER_ROLE);
      return held.answer.then((response) => {
        if (response.ok) direct = [];
        return response;
      });
    }
    if (path.endsWith('/permissions') && holdReads) return reread.answer;
    return path.endsWith('/permissions')
      ? success({
          userId: 'user-7',
          role: 'editor',
          permissions: direct,
          version: direct.length === 0 ? 1 : 0,
        })
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
    accept: () => held.settle(() => success({ userId: 'user-7', permissions: [], version: 1 })),
    settle: held.settle,
    holdRefetch: () => {
      holdReads = true;
      refuseDeletes = true;
      dialog.store.dispatch(
        permissionsApi.util.invalidateTags([{ type: 'Permissions', id: 'user-7' }]),
      );
    },
    acceptRefetch: () => {
      holdReads = false;
      reread.settle(() =>
        success({ userId: 'user-7', role: 'editor', permissions: [DIRECT], version: 0 }),
      );
    },
    deleteAttempts: () => deletes,
  };
}

registerFormTestLifecycle();

it('holds the focused remove control through a reconciliation read and refuses another write', async () => {
  const dialog = await renderDialog('en');
  dialog.remove.focus();
  dialog.holdRefetch();
  try {
    await waitFor(() => expect(availability(dialog.remove)).toEqual(HELD));
    fireEvent.click(dialog.remove);
    expect(document.activeElement).toBe(dialog.remove);
  } finally {
    dialog.acceptRefetch();
  }
  await waitFor(() => expect(availability(dialog.remove)).toEqual(IDLE));
  expect(dialog.deleteAttempts()).toBe(0);
  expect(document.activeElement).toBe(dialog.remove);
});

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
