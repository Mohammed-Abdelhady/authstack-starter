// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import {
  makeStore,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ReauthStep } from '../steps/ReauthStep';
import { TwoFactorDisableDialog } from '../TwoFactorDisableDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};

registerFormTestLifecycle();

function signedInStore() {
  const store = makeStore();
  store.dispatch(loginFulfilled(USER));
  return store;
}

function expectUsernameBefore(password: HTMLElement) {
  const username = screen.getByTestId('account-username');
  expect(username.getAttribute('autocomplete')).toBe('username');
  expect(username).toHaveProperty('value', 'layla@example.com');
  expect(username).toHaveProperty('hidden', true);
  expect(username.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe('fields a password manager reads on the two-factor forms', () => {
  it('names the account on the password prompt and hands on the password alone', async () => {
    const onContinue = vi.fn();
    const { message } = await renderForm(
      'en',
      <ReauthStep hasPassword isBusy={false} onContinue={onContinue} />,
      signedInStore(),
    );
    const password = screen.getByLabelText(message('settings.twoFactor.setup.reauth.password'));

    expectUsernameBefore(password);

    fireEvent.change(password, { target: { value: 'Passw0rdLayla' } });
    fireEvent.submit(screen.getByTestId('two-factor-reauth-form'));
    await waitFor(() => expect(onContinue.mock.calls).toEqual([['Passw0rdLayla']]));
  });

  it('has no username field for an account that re-enters no password', async () => {
    await renderForm(
      'en',
      <ReauthStep hasPassword={false} isBusy={false} onContinue={vi.fn()} />,
      signedInStore(),
    );

    expect(screen.queryByTestId('account-username')).toBeNull();
  });

  it('names the account on the turn-off dialog when it asks for the password', async () => {
    stubNetwork(() => success({}));
    const { message } = await renderForm(
      'en',
      <TwoFactorDisableDialog open onOpenChange={vi.fn()} hasPassword />,
      signedInStore(),
    );

    expectUsernameBefore(screen.getByLabelText(message('settings.twoFactor.disable.password')));
  });

  it('has no username field on the turn-off dialog of a passwordless account', async () => {
    stubNetwork(() => success({}));
    await renderForm(
      'en',
      <TwoFactorDisableDialog open onOpenChange={vi.fn()} hasPassword={false} />,
      signedInStore(),
    );

    expect(screen.queryByTestId('account-username')).toBeNull();
  });
});
