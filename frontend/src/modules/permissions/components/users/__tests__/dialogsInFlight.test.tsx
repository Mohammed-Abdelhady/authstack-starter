// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { heldAnswer, isHeld } from '@/tests/busyControls';
import { expectClosableOnlyOnceSettled } from '@/tests/dialogBusy';
import {
  SERVER_TEXT,
  descriptions,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { EditUserDialog } from '../EditUserDialog';
import { UserPermissionsDialog } from '../UserPermissionsDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

type OpenChange = (open: boolean) => void;

const READS = 'reports:read:all';
const EXPORTS = 'reports:export:all';

async function editSent(locale: AppLocale) {
  const held = heldAnswer();
  stubNetwork((request) => (request.method === 'GET' ? success({}) : held.answer));
  const onOpenChange = vi.fn<OpenChange>();
  const view = await renderForm(
    locale,
    <EditUserDialog
      currentVersion={0}
      userId="user-1"
      currentName="Layla Haddad"
      currentEmail="layla@example.com"
      open
      onOpenChange={onOpenChange}
    />,
  );
  const email = screen.getByTestId('edit-user-email-input');
  fireEvent.change(email, { target: { value: 'layla.haddad@example.com' } });
  fireEvent.click(screen.getByTestId('submit-edit-user-button'));
  return {
    ...view,
    email,
    closes: () => onOpenChange.mock.calls.filter(([open]) => !open).length,
    settle: held.settle,
  };
}

/** The permissions dialog of a user with two direct permissions, every write held. */
async function permissionsDialog(locale: AppLocale) {
  const held = heldAnswer();
  const requests = stubNetwork((request, path) => {
    if (request.method !== 'GET') return held.answer;
    return path.endsWith('/permissions')
      ? success({ version: 0, userId: 'user-7', role: 'night-desk', permissions: [READS, EXPORTS] })
      : success({ id: 'role-night', slug: 'night-desk', name: 'Night Desk', permissions: [] });
  });
  const onOpenChange = vi.fn<OpenChange>();
  const view = await renderForm(
    locale,
    <UserPermissionsDialog open onOpenChange={onOpenChange} userId="user-7" />,
  );
  await screen.findByTestId(`remove-permission-${READS}`);
  return {
    ...view,
    requests,
    closes: () => onOpenChange.mock.calls.filter(([open]) => !open).length,
    settle: held.settle,
  };
}

/** jsdom has no layout, so the observer a checked Radix checkbox asks for never fires. */
class InertResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

registerFormTestLifecycle();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', InertResizeObserver);
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('a user dialog with its request in flight in %s', (locale) => {
  it('edit user: cannot be closed until the answer arrives', async () => {
    const view = await editSent(locale);

    await expectClosableOnlyOnceSettled({
      dialogId: 'edit-user-dialog',
      cancelId: 'cancel-edit-user-button',
      closes: view.closes,
      refuse: () => view.settle(() => refusalWith(500, ErrorCode.INTERNAL_ERROR)),
      heldControl: () => view.email,
    });
  });

  it('edit user: marks and focuses the address the server says is taken, and raises no toast', async () => {
    const view = await editSent(locale);

    view.settle(() => refusalWith(409, ErrorCode.EMAIL_ALREADY_EXISTS));

    await waitFor(() => expect(view.email.getAttribute('aria-invalid')).toBe('true'));
    expect(descriptions(view.email)).toEqual([view.message('errors.codes.EMAIL_ALREADY_EXISTS')]);
    await waitFor(() => expect(document.activeElement).toBe(view.email));
    expect(screen.queryByTestId('edit-user-error')).toBeNull();
    expect(view.errorToasts()).toEqual([]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it('remove permission: only the pressed button says it is busy, and the dialog cannot be closed', async () => {
    const view = await permissionsDialog(locale);
    const pressed = screen.getByTestId(`remove-permission-${READS}`);
    const other = screen.getByTestId(`remove-permission-${EXPORTS}`);

    fireEvent.click(pressed);

    await waitFor(() => expect(pressed.getAttribute('aria-busy')).toBe('true'));
    expect(other.getAttribute('aria-busy')).toBe('false');
    // The other removal waits its turn: one request at a time.
    expect(isHeld(other)).toBe(true);
    fireEvent.click(other);

    await expectClosableOnlyOnceSettled({
      dialogId: 'user-permissions-dialog',
      closes: view.closes,
      refuse: () => view.settle(() => refusalWith(403, ErrorCode.CANNOT_MODIFY_HIGHER_ROLE)),
      heldControl: () => pressed,
    });

    expect(view.requests.filter((entry) => entry.startsWith('DELETE')).length).toBe(1);
    expect(
      view.requests.filter((entry) => entry === 'GET /api/admin/users/user-7/permissions'),
    ).toHaveLength(1);
    expect(screen.getByTestId('remove-permission-error').textContent).toBe(
      view.message('errors.codes.CANNOT_MODIFY_HIGHER_ROLE'),
    );
    expect(view.errorToasts()).toEqual([]);
  });

  it('add permissions: cannot be closed until the answer arrives, then says why inside', async () => {
    const view = await permissionsDialog(locale);
    fireEvent.click(screen.getByTestId('add-permission-button'));
    await screen.findByTestId('permission-search-dialog');
    fireEvent.click(screen.getByTestId('permission-checkbox-users:read:all'));
    const confirm = screen.getByTestId('confirm-add-permissions');
    await waitFor(() => expect(confirm.matches(':disabled')).toBe(false));

    fireEvent.click(confirm);

    await waitFor(() => expect(isHeld(confirm)).toBe(true));
    fireEvent.keyDown(screen.getByTestId('permission-search-dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('cancel-add-permissions'));
    expect(screen.queryByTestId('permission-search-dialog')).not.toBeNull();

    view.settle(() => refusalWith(403, ErrorCode.CANNOT_MODIFY_HIGHER_ROLE));

    const reason = await screen.findByTestId('add-permissions-error');
    expect(reason.textContent).toBe(view.message('errors.codes.CANNOT_MODIFY_HIGHER_ROLE'));
    expect(screen.getByTestId('permission-search-dialog').contains(reason)).toBe(true);
    expect(view.errorToasts()).toEqual([]);
    await waitFor(() => expect(isHeld(confirm)).toBe(false));

    fireEvent.keyDown(screen.getByTestId('permission-search-dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('permission-search-dialog')).toBeNull());
  });

  it('reconciles the first permission when a later grant in the loop is refused', async () => {
    const persisted = new Set([READS, EXPORTS]);
    const heldFirstRefetch = heldAnswer();
    const heldRefusal = heldAnswer();
    const heldReconciliation = heldAnswer();
    const bodies: unknown[] = [];
    let writes = 0;
    let permissionReads = 0;
    stubNetwork(async (request, path) => {
      if (request.method === 'POST') {
        const body = (await request.json()) as { permission: string };
        bodies.push(body);
        writes += 1;
        if (writes === 2) return heldRefusal.answer;
        persisted.add(body.permission);
        return success({
          version: Math.min(writes, 1),
          userId: 'user-7',
          role: 'night-desk',
          permissions: [...persisted],
        });
      }
      if (path.endsWith('/permissions')) {
        permissionReads += 1;
        if (permissionReads === 2) return heldFirstRefetch.answer;
        if (permissionReads === 3) return heldReconciliation.answer;
        return success({
          version: Math.min(writes, 1),
          userId: 'user-7',
          role: 'night-desk',
          permissions: [...persisted],
        });
      }
      return success({ id: 'role-night', slug: 'night-desk', name: 'Night Desk', permissions: [] });
    });
    const form = await renderForm(
      locale,
      <UserPermissionsDialog open onOpenChange={vi.fn()} userId="user-7" />,
    );
    await screen.findByTestId(`remove-permission-${READS}`);
    fireEvent.click(screen.getByTestId('add-permission-button'));
    await screen.findByTestId('permission-search-dialog');
    fireEvent.click(screen.getByTestId('permission-checkbox-users:read:all'));
    fireEvent.click(screen.getByTestId('permission-checkbox-users:create:all'));
    const confirm = screen.getByTestId('confirm-add-permissions');
    fireEvent.click(confirm);

    await waitFor(() => expect(bodies).toHaveLength(2));
    await waitFor(() => expect(permissionReads).toBe(2));
    expect(isHeld(confirm)).toBe(true);
    expect(screen.queryByTestId('add-permissions-error')).toBeNull();

    heldFirstRefetch.settle(() =>
      success({
        version: Math.min(writes, 1),
        userId: 'user-7',
        role: 'night-desk',
        permissions: [...persisted],
      }),
    );
    await screen.findByTestId('direct-permission-users:read:all');
    expect(screen.queryByTestId('direct-permission-users:create:all')).toBeNull();

    heldRefusal.settle(() => refusalWith(403, ErrorCode.CANNOT_MODIFY_HIGHER_ROLE));
    await waitFor(() => expect(permissionReads).toBe(3));
    expect(isHeld(confirm)).toBe(true);
    expect(screen.queryByTestId('add-permissions-error')).toBeNull();

    heldReconciliation.settle(() =>
      success({
        version: Math.min(writes, 1),
        userId: 'user-7',
        role: 'night-desk',
        permissions: [...persisted],
      }),
    );
    await screen.findByTestId('direct-permission-users:read:all');
    await screen.findByTestId('add-permissions-error');
    await waitFor(() => expect(isHeld(confirm)).toBe(false));

    expect(bodies).toEqual([
      { permission: 'users:read:all', version: 0 },
      { permission: 'users:create:all', version: 1 },
    ]);
    expect(screen.getByTestId('add-permissions-error').textContent).toBe(
      form.message('errors.codes.CANNOT_MODIFY_HIGHER_ROLE'),
    );
    expect(screen.getByTestId('permission-search-dialog')).toBeTruthy();
    expect(form.successToasts()).toEqual([]);
  });

  it('re-reads permissions after the server applies a grant but its response is lost', async () => {
    const persisted = new Set([READS, EXPORTS]);
    const heldRead = heldAnswer();
    let writes = 0;
    let permissionReads = 0;
    stubNetwork(async (request, path) => {
      if (request.method === 'POST') {
        writes += 1;
        persisted.add('users:read:all');
        throw new TypeError('Failed to fetch');
      }
      if (path.endsWith('/permissions')) {
        permissionReads += 1;
        if (permissionReads > 1) return heldRead.answer;
        return success({
          version: Math.min(writes, 1),
          userId: 'user-7',
          role: 'night-desk',
          permissions: [...persisted],
        });
      }
      return success({ id: 'role-night', slug: 'night-desk', name: 'Night Desk', permissions: [] });
    });
    const form = await renderForm(
      locale,
      <UserPermissionsDialog open onOpenChange={vi.fn()} userId="user-7" />,
    );
    await screen.findByTestId(`remove-permission-${READS}`);
    fireEvent.click(screen.getByTestId('add-permission-button'));
    await screen.findByTestId('permission-search-dialog');
    fireEvent.click(screen.getByTestId('permission-checkbox-users:read:all'));
    const confirm = screen.getByTestId('confirm-add-permissions');
    fireEvent.click(confirm);

    await waitFor(() => expect(permissionReads).toBe(2));
    expect(isHeld(confirm)).toBe(true);
    expect(screen.getByTestId('permission-search-dialog')).toBeTruthy();
    expect(screen.queryByTestId('direct-permission-users:read:all')).toBeNull();

    heldRead.settle(() =>
      success({
        version: Math.min(writes, 1),
        userId: 'user-7',
        role: 'night-desk',
        permissions: [...persisted],
      }),
    );

    await screen.findByTestId('direct-permission-users:read:all');
    await screen.findByTestId('add-permissions-error');
    await waitFor(() => expect(isHeld(confirm)).toBe(false));

    expect(writes).toBe(1);
    expect(screen.getByTestId('add-permissions-error').textContent).toBe(
      form.message('toast.error.networkError'),
    );
  });
});
