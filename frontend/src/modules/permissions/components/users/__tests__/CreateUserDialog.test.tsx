// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  SERVER_TEXT,
  descriptions,
  refusal,
  refuseWrites,
  renderForm,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { isHeld } from '@/tests/busyControls';
import { askToClose, isOpen } from '@/tests/dialogBusy';
import { CreateUserDialog } from '../CreateUserDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ROLES = {
  roles: [
    {
      id: 'role-user',
      slug: 'user',
      name: 'User',
      permissions: [],
      isSystemRole: true,
      isProtected: false,
    },
  ],
  total: 1,
  page: 1,
};

/** A page that owns the dialog and can open it again. */
function Host() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <CreateUserDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

async function submitCreate(locale: AppLocale) {
  const form = await renderForm(locale, <Host />);
  const label = (key: string) => form.message(`users.createUser.${key}`);
  const email = screen.getByRole('textbox', { name: label('email') });
  const name = screen.getByRole('textbox', { name: label('name') });
  const role = screen.getByRole('combobox', { name: label('role') });

  fireEvent.change(email, { target: { value: 'layla@example.com' } });
  fireEvent.change(name, { target: { value: 'Layla Haddad' } });
  fireEvent.change(screen.getByLabelText(label('password')), {
    target: { value: 'Passw0rd!Layla' },
  });
  fireEvent.click(screen.getByRole('button', { name: label('submit') }));

  return { ...form, email, name, role };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('CreateUserDialog refused by the server in %s', (locale) => {
  it('marks the rejected fields, focuses the first and raises no toast', async () => {
    refuseWrites(['role', 'name', 'nickname'], ROLES);

    const { email, name, role, fieldMessage, errorToasts } = await submitCreate(locale);

    await waitFor(() => {
      expect(name.getAttribute('aria-invalid')).toBe('true');
    });
    expect(descriptions(name)).toEqual([fieldMessage]);
    expect(role.getAttribute('aria-invalid')).toBe('true');
    expect(descriptions(role)).toEqual([fieldMessage]);
    expect(email.getAttribute('aria-invalid')).toBe('false');
    // The field is focused once the store reports the end of the request.
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
    // The marked fields say it. No toast repeats it.
    expect(errorToasts()).toEqual([]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it('tells the browser its password field takes a new password', async () => {
    refuseWrites([], ROLES);
    const { message } = await renderForm(locale, <Host />);

    expect(
      screen.getByLabelText(message('users.createUser.password')).getAttribute('autocomplete'),
    ).toBe('new-password');
  });

  it('cannot be closed while its request is in flight, and opens clean after the refusal was closed', async () => {
    const { promise: pendingCreate, resolve: answerCreate } = Promise.withResolvers<Response>();
    stubNetwork((request) => (request.method === 'GET' ? success(ROLES) : pendingCreate));

    const { message, fieldMessage } = await submitCreate(locale);
    await askToClose('create-user-dialog');
    fireEvent.click(screen.getByTestId('cancel-create-user-button'));
    await askToClose('create-user-dialog');
    expect(isOpen('create-user-dialog')).toBe(true);

    answerCreate(refusal(['name']));
    const refused = screen.getByRole('textbox', { name: message('users.createUser.name') });
    await waitFor(() => {
      expect(descriptions(refused)).toEqual([fieldMessage]);
    });
    await waitFor(() => {
      expect(isHeld(screen.getByTestId('cancel-create-user-button'))).toBe(false);
    });
    await askToClose('create-user-dialog');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const name = await screen.findByRole('textbox', { name: message('users.createUser.name') });
    expect(name.getAttribute('value')).toBe('');
    expect(name.getAttribute('aria-invalid')).toBe('false');
    expect(descriptions(name)).toEqual([]);
  });
});
