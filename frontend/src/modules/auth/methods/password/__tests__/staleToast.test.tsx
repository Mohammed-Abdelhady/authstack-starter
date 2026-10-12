// @vitest-environment jsdom
import { isHeld } from '@/tests/busyControls';
import { change, navigation, SIGNED_IN_USER } from './registrationHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import {
  refuseFirstWrite,
  sendRefusedInPlaceThenAgain,
  sendRefusedThenAgain,
  toastOrder,
} from '@/tests/staleToast';
import { ChangePasswordCard } from '../ChangePasswordCard';
import { PasswordSignInForm } from '../PasswordSignInForm';
import { ResetPasswordForm } from '../ResetPasswordForm';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

/** Sends the form and tells when its fields take input again. */
function sender(formId: string, firstField: string) {
  return {
    send: () => fireEvent.submit(screen.getByTestId(formId)),
    isIdle: () => !isHeld(screen.getByTestId(firstField)),
  };
}

describe('a refused password form leaves no toast behind when the form is sent again', () => {
  it('on the sign-in form, before the person is taken to the dashboard', async () => {
    refuseFirstWrite({ requiresTwoFactor: false, user: SIGNED_IN_USER });
    await renderForm('en', <PasswordSignInForm redirect={null} isOnlyMethod />);
    change('login-email-input', 'layla@example.com');
    change('login-password-input', 'Passw0rdLayla');
    const { send, isIdle } = sender('login-form', 'login-email-input');

    await sendRefusedThenAgain(send, isIdle);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
    expect(toastOrder()).toEqual(['error', 'dismiss']);
  });

  it('on the reset password form, which says why itself and raises no toast', async () => {
    navigation.search = 'email=layla@example.com';
    refuseFirstWrite({ message: 'reset' });
    await renderForm('en', <ResetPasswordForm />);
    const fill = () => {
      change('reset-password-code-input', '123456');
      change('reset-password-password-input', 'NewPassw0rdLayla');
      change('reset-password-confirmPassword-input', 'NewPassw0rdLayla');
    };
    const { send, isIdle } = sender('reset-password-form', 'reset-password-code-input');

    // The form says why itself, so the refusal raises no toast to take down.
    await sendRefusedInPlaceThenAgain(
      () => {
        fill();
        send();
      },
      () => screen.queryByTestId('reset-password-error') !== null,
      isIdle,
    );

    await waitFor(() => expect(toastOrder()).toEqual(['success']));
  });

  it('on the change password form, which says why itself and raises no toast', async () => {
    refuseFirstWrite({ message: 'changed' }, () => ({ methods: { password: true } }));
    const { message } = await renderForm('en', <ChangePasswordCard />);
    await screen.findByTestId('change-password-form');
    const field = (key: string) => screen.getByLabelText(message(`settings.password.${key}`));
    const fill = () => {
      fireEvent.change(field('currentPassword'), { target: { value: 'OldPassw0rdLayla' } });
      fireEvent.change(field('newPassword'), { target: { value: 'NewPassw0rdLayla' } });
      fireEvent.change(field('confirmPassword'), { target: { value: 'NewPassw0rdLayla' } });
    };

    await sendRefusedInPlaceThenAgain(
      () => {
        fill();
        fireEvent.submit(screen.getByTestId('change-password-form'));
      },
      () => screen.queryByTestId('change-password-error') !== null,
      () => !isHeld(field('currentPassword')),
    );

    await waitFor(() => expect(toastOrder()).toEqual(['success']));
    expect(screen.queryByTestId('change-password-error')).toBeNull();
  });
});
