// @vitest-environment jsdom
import { navigation, SIGNED_IN_USER } from './registrationHarness';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import {
  makeStore,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ChangePasswordCard } from '../ChangePasswordCard';
import { ResetPasswordForm } from '../ResetPasswordForm';

registerFormTestLifecycle();

function signedInStore() {
  const store = makeStore();
  store.dispatch(loginFulfilled(SIGNED_IN_USER));
  return store;
}

describe('fields a password manager reads', () => {
  it('names the account on the change password form without showing or sending it', async () => {
    const bodies: unknown[] = [];
    stubNetwork(async (request) => {
      if (request.method !== 'POST') return success({ methods: { password: true } });
      bodies.push(await request.json());
      return success({ message: 'changed' });
    });
    const { message, successToasts } = await renderForm(
      'en',
      <ChangePasswordCard />,
      signedInStore(),
    );
    const label = (key: string) => message(`settings.password.${key}`);
    const username = screen.getByTestId('account-username');
    const currentPassword = screen.getByLabelText(label('currentPassword'));

    expect(username.getAttribute('autocomplete')).toBe('username');
    expect(username).toHaveProperty('value', 'layla@example.com');
    expect(username).toHaveProperty('hidden', true);
    expect(username).toHaveProperty('form', screen.getByTestId('change-password-form'));
    // A password manager pairs a password with the username field before it.
    expect(
      username.compareDocumentPosition(currentPassword) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryAllByRole('textbox')).toEqual([]);

    fireEvent.change(currentPassword, { target: { value: 'OldPassw0rdLayla' } });
    fireEvent.change(screen.getByLabelText(label('newPassword')), {
      target: { value: 'NewPassw0rdLayla' },
    });
    fireEvent.change(screen.getByLabelText(label('confirmPassword')), {
      target: { value: 'NewPassw0rdLayla' },
    });
    fireEvent.click(screen.getByRole('button', { name: label('submit') }));

    await waitFor(() => expect(successToasts()).toEqual([label('success')]));
    expect(bodies).toEqual([
      { currentPassword: 'OldPassw0rdLayla', newPassword: 'NewPassw0rdLayla' },
    ]);
  });

  it('leaves the username field out while the account is not known', async () => {
    stubNetwork(() => success({ methods: { password: true } }));
    await renderForm('en', <ChangePasswordCard />);

    expect(screen.queryByTestId('account-username')).toBeNull();
  });

  it('marks the address on the reset form as the username of the new password', async () => {
    navigation.search = 'email=layla@example.com';
    stubNetwork(() => success({}));
    const { message } = await renderForm('en', <ResetPasswordForm />);

    const email = screen.getByRole('textbox', { name: message('auth.resetPassword.email') });
    expect(email.getAttribute('autocomplete')).toBe('username');
    expect(email).toHaveProperty('value', 'layla@example.com');
  });
});
