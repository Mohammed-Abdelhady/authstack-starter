// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { refuseFirstWrite, toastOrder } from '@/tests/staleToast';
import { storeSignedInAs } from '@/tests/signedIn';
import { CreateUserButton } from '../CreateUserButton';
import { CreateUserDialog } from '../CreateUserDialog';
import { EditUserDialog } from '../EditUserDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const SAVED_USER = { id: 'user-1', name: 'Layla Haddad', email: 'layla.haddad@example.com' };

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function fillCreateForm() {
  type('create-user-email-input', 'layla.haddad@example.com');
  type('create-user-name-input', 'Layla Haddad');
  type('create-user-password-input', 'Passw0rdLayla');
}

registerFormTestLifecycle();

describe('a refused user form says so in the form and raises no toast', () => {
  it('on the create user form, and the reason goes when the form is sent again', async () => {
    refuseFirstWrite(SAVED_USER, () => ({ roles: [], total: 0, page: 1 }));
    const { message } = await renderForm('en', <CreateUserDialog open onOpenChange={vi.fn()} />);
    const send = () =>
      fireEvent.click(screen.getByRole('button', { name: message('users.createUser.submit') }));

    fillCreateForm();
    send();
    const reason = await screen.findByTestId('create-user-error');
    expect(reason.textContent).toBe(message('errors.codes.VALIDATION_ERROR'));
    expect(toastOrder()).toEqual([]);

    // An accepted create empties the form, so it is filled in each time.
    fillCreateForm();
    send();

    await waitFor(() => expect(toastOrder()).toEqual(['success']));
    expect(screen.queryByTestId('create-user-error')).toBeNull();
  });

  it('on the edit user form, and the reason goes when the form is sent again', async () => {
    refuseFirstWrite(SAVED_USER);
    const { message } = await renderForm(
      'en',
      <EditUserDialog
        userId="user-1"
        currentName="Layla Haddad"
        currentEmail="layla@example.com"
        open
        onOpenChange={vi.fn()}
      />,
    );
    type('edit-user-email-input', 'layla.haddad@example.com');

    fireEvent.click(screen.getByTestId('submit-edit-user-button'));
    const reason = await screen.findByTestId('edit-user-error');
    expect(reason.textContent).toBe(message('errors.codes.VALIDATION_ERROR'));
    expect(toastOrder()).toEqual([]);

    fireEvent.click(screen.getByTestId('submit-edit-user-button'));

    await waitFor(() => expect(toastOrder()).toEqual(['success']));
    expect(screen.queryByTestId('edit-user-error')).toBeNull();
  });

  it('leaves nothing on screen once the create user dialog is closed, as its page mounts it', async () => {
    stubNetwork((request) =>
      request.method === 'GET'
        ? success({ roles: [], total: 0, page: 1 })
        : refusalWith(409, ErrorCode.EMAIL_ALREADY_EXISTS),
    );
    const { message } = await renderForm('en', <CreateUserButton />, storeSignedInAs('admin'));
    fireEvent.click(screen.getByTestId('create-user-button'));
    await screen.findByTestId('create-user-dialog');
    fillCreateForm();
    fireEvent.click(screen.getByRole('button', { name: message('users.createUser.submit') }));
    await waitFor(() =>
      expect(screen.getByTestId('email-error').textContent).toBe(
        message('errors.codes.EMAIL_ALREADY_EXISTS'),
      ),
    );

    fireEvent.keyDown(screen.getByTestId('create-user-dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('create-user-dialog')).toBeNull());
    // No toast was raised for the refusal, so none outlives the dialog.
    expect(toastOrder()).toEqual([]);

    fireEvent.click(screen.getByTestId('create-user-button'));
    await screen.findByTestId('create-user-dialog');
    expect(screen.queryByTestId('email-error')).toBeNull();
    expect(screen.getByTestId('create-user-email-input')).toHaveProperty('value', '');
  });
});
