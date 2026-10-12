// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { heldAnswer } from '@/tests/busyControls';
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
import type { Role } from '../../../api/rolesApi';
import { CreateRoleDialog } from '../CreateRoleDialog';
import { DeleteRoleDialog } from '../DeleteRoleDialog';
import { EditRoleDialog } from '../EditRoleDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const ROLE: Role = {
  id: 'role-support',
  name: 'Support Team',
  slug: 'support-team',
  description: 'Answers tickets',
  isSystemRole: false,
  isProtected: false,
  level: 1,
  permissions: ['users:read:all'],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

type OpenChange = (open: boolean) => void;
type Message = (key: string) => string;

const DIALOGS = [
  {
    name: 'create role',
    dialogId: 'create-role-dialog',
    cancelId: 'cancel-button',
    nameField: 'role-name-input',
    render: (onOpenChange: OpenChange) => <CreateRoleDialog open onOpenChange={onOpenChange} />,
    send: (message: Message) => {
      fireEvent.change(screen.getByTestId('role-name-input'), { target: { value: 'Night Desk' } });
      fireEvent.click(screen.getByTestId('permission-checkbox-users:read:all'));
      fireEvent.click(screen.getByRole('button', { name: message('roles.form.create') }));
    },
  },
  {
    name: 'edit role',
    dialogId: 'edit-role-dialog',
    cancelId: 'cancel-button',
    nameField: 'edit-role-name-input',
    render: (onOpenChange: OpenChange) => (
      <EditRoleDialog open onOpenChange={onOpenChange} role={ROLE} />
    ),
    send: (message: Message) => {
      fireEvent.change(screen.getByTestId('edit-role-name-input'), {
        target: { value: 'Night Desk' },
      });
      fireEvent.click(screen.getByRole('button', { name: message('roles.form.update') }));
    },
  },
] as const;

async function sent(
  locale: AppLocale,
  render: (onOpenChange: OpenChange) => React.ReactElement,
  send: (message: Message) => void,
) {
  const held = heldAnswer();
  const requests = stubNetwork((request) => (request.method === 'GET' ? success({}) : held.answer));
  const onOpenChange = vi.fn<OpenChange>();
  const view = await renderForm(locale, render(onOpenChange));
  send(view.message);
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
] as const)('a role dialog with its request in flight in %s', (locale) => {
  describe.each(DIALOGS)('$name', ({ dialogId, cancelId, nameField, render, send }) => {
    it('cannot be closed until the answer arrives', async () => {
      const view = await sent(locale, render, send);

      await expectClosableOnlyOnceSettled({
        dialogId,
        cancelId,
        closes: view.closes,
        refuse: () => view.settle(() => refusalWith(500, ErrorCode.INTERNAL_ERROR)),
        heldControl: () => screen.getByTestId(nameField),
      });
      expect(view.requests.filter((entry) => !entry.startsWith('GET')).length).toBe(1);
    });

    it('marks the name, with a reason about the name or its code, when the server says it is taken', async () => {
      const view = await sent(locale, render, send);
      const name = screen.getByTestId(nameField);

      view.settle(() => refusalWith(409, ErrorCode.ROLE_NAME_TAKEN));

      await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
      expect(descriptions(name).at(-1)).toBe(view.message('errors.codes.ROLE_NAME_TAKEN'));
      await waitFor(() => expect(document.activeElement).toBe(name));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(view.errorToasts()).toEqual([]);
      expect(document.body.textContent).not.toContain(SERVER_TEXT);
    });

    it('says a refusal about no field in the alert of the form', async () => {
      const view = await sent(locale, render, send);

      view.settle(() => refusalWith(403, ErrorCode.FORBIDDEN));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(view.message('errors.codes.FORBIDDEN'));
      expect(screen.getByTestId(dialogId).contains(alert)).toBe(true);
      expect(screen.getByTestId(nameField).getAttribute('aria-invalid')).toBe('false');
      expect(view.errorToasts()).toEqual([]);
    });
  });

  it('delete role: cannot be closed until the answer arrives, and sends one delete', async () => {
    const view = await sent(
      locale,
      (onOpenChange) => <DeleteRoleDialog open onOpenChange={onOpenChange} role={ROLE} />,
      (message) =>
        fireEvent.click(screen.getByRole('button', { name: message('roles.delete.confirm') })),
    );

    await expectClosableOnlyOnceSettled({
      dialogId: 'delete-role-dialog',
      cancelId: 'cancel-button',
      closes: view.closes,
      refuse: () => view.settle(() => refusalWith(400, ErrorCode.ROLE_HAS_USERS, { count: 2 })),
      heldControl: () => screen.getByTestId('cancel-button'),
    });
    expect(view.requests).toEqual(['DELETE /api/roles/role-support']);
  });
});
