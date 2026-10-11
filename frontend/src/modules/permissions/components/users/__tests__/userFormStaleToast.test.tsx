// @vitest-environment jsdom
import { isHeld } from '@/tests/busyControls';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { refuseFirstWrite, sendRefusedThenAgain, toastOrder } from '@/tests/staleToast';
import { CreateUserDialog } from '../CreateUserDialog';
import { EditUserDialog } from '../EditUserDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const SAVED_USER = { id: 'user-1', name: 'Layla Haddad', email: 'layla.haddad@example.com' };

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

registerFormTestLifecycle();

describe('the toast of a refused user form is gone before the corrected save is announced', () => {
  it('on the create user form', async () => {
    refuseFirstWrite(SAVED_USER, () => ({ roles: [], total: 0, page: 1 }));
    const { message } = await renderForm('en', <CreateUserDialog open onOpenChange={vi.fn()} />);
    const fillAndSend = () => {
      type('create-user-email-input', 'layla.haddad@example.com');
      type('create-user-name-input', 'Layla Haddad');
      type('create-user-password-input', 'Passw0rdLayla');
      fireEvent.click(screen.getByRole('button', { name: message('users.createUser.submit') }));
    };

    // An accepted create empties the form, so it is filled in each time.
    await sendRefusedThenAgain(
      fillAndSend,
      () => !isHeld(screen.getByTestId('create-user-email-input')),
    );

    await waitFor(() => expect(toastOrder()).toEqual(['error', 'dismiss', 'success']));
  });

  it('on the edit user form', async () => {
    refuseFirstWrite(SAVED_USER);
    await renderForm(
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

    await sendRefusedThenAgain(
      () => fireEvent.click(screen.getByTestId('submit-edit-user-button')),
      () => !isHeld(screen.getByTestId('edit-user-email-input')),
    );

    await waitFor(() => expect(toastOrder()).toEqual(['error', 'dismiss', 'success']));
  });

  it('goes with the create user dialog when it is closed, and a clean close takes nothing down', async () => {
    refuseFirstWrite(SAVED_USER, () => ({ roles: [], total: 0, page: 1 }));
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button data-testid="reopen" onClick={() => setOpen(true)} />
          <CreateUserDialog open={open} onOpenChange={setOpen} />
        </>
      );
    }
    const { message } = await renderForm('en', <Host />);
    type('create-user-email-input', 'layla.haddad@example.com');
    type('create-user-name-input', 'Layla Haddad');
    type('create-user-password-input', 'Passw0rdLayla');
    fireEvent.click(screen.getByRole('button', { name: message('users.createUser.submit') }));
    await waitFor(() => expect(toastOrder()).toEqual(['error']));

    fireEvent.keyDown(screen.getByTestId('create-user-dialog'), { key: 'Escape' });

    await waitFor(() => expect(toastOrder()).toEqual(['error', 'dismiss']));

    fireEvent.click(screen.getByTestId('reopen'));
    fireEvent.keyDown(await screen.findByTestId('create-user-dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('create-user-dialog')).toBeNull());
    expect(toastOrder()).toEqual(['error', 'dismiss']);
  });
});
