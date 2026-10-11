// @vitest-environment jsdom
import { change, fillActivation, navigation, SIGNED_IN_USER } from './registrationHarness';
import * as React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import {
  clickTwiceInOneTick,
  submitTwiceInOneTick,
  writesOf,
} from '@/modules/auth/__tests__/submitTwice';
import { ActivationForm } from '@/modules/auth/components/ActivationForm';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import { PasswordSignInForm } from '../PasswordSignInForm';
import { RegisterForm } from '../RegisterForm';
import { ResetPasswordForm } from '../ResetPasswordForm';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

const EMAIL = 'layla@example.com';
const PASSWORD = 'Passw0rdLayla';

describe('two submissions in one tick send one request', () => {
  it('signs in once', async () => {
    const requests = stubNetwork(() => success({ requiresTwoFactor: false, user: SIGNED_IN_USER }));
    await renderForm('en', <PasswordSignInForm redirect={null} isOnlyMethod />);
    change('login-email-input', EMAIL);
    change('login-password-input', PASSWORD);

    submitTwiceInOneTick(screen.getByTestId('login-form'));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
    expect(requests).toEqual(['POST /api/auth/login']);
  });

  it('accepts a new sign-in after a refused one', async () => {
    let attempts = 0;
    const requests = stubNetwork(() => {
      attempts += 1;
      return attempts === 1
        ? refusalWith(401, ErrorCode.INVALID_CREDENTIALS)
        : success({ requiresTwoFactor: false, user: SIGNED_IN_USER });
    });
    await renderForm('en', <PasswordSignInForm redirect={null} isOnlyMethod />);
    change('login-email-input', EMAIL);
    change('login-password-input', PASSWORD);

    submitTwiceInOneTick(screen.getByTestId('login-form'));
    await screen.findByTestId('login-error');
    submitTwiceInOneTick(screen.getByTestId('login-form'));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
    expect(requests).toEqual(['POST /api/auth/login', 'POST /api/auth/login']);
  });

  it('registers once', async () => {
    const requests = stubNetwork((request) =>
      request.method === 'POST'
        ? success({ email: EMAIL })
        : success({ methods: { password: true, magicLink: false, passkeys: false, oauth: [] } }),
    );
    await renderForm('en', <RegisterForm />);
    change('register-email-input', EMAIL);

    submitTwiceInOneTick(screen.getByTestId('register-form'));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/auth/activate'));
    expect(writesOf(requests)).toEqual(['POST /api/auth/register']);
  });

  it('asks for one reset code', async () => {
    const requests = stubNetwork(() => success({ message: 'sent' }));
    await renderForm('en', <ForgotPasswordForm />);
    change('forgot-password-email-input', EMAIL);

    submitTwiceInOneTick(screen.getByTestId('forgot-password-form'));

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        '/auth/reset-password?email=layla%40example.com',
      ),
    );
    expect(requests).toEqual(['POST /api/auth/forgot-password']);
  });

  it('spends a reset code once', async () => {
    navigation.search = `email=${EMAIL}`;
    // A refusal keeps the form on screen, so the test ends without the
    // redirect timer a success starts.
    const requests = stubNetwork(() => refusalWith(400, ErrorCode.PASSWORD_RESET_CODE_INVALID));
    await renderForm('en', <ResetPasswordForm />);
    change('reset-password-code-input', '000000');
    change('reset-password-password-input', PASSWORD);
    change('reset-password-confirmPassword-input', PASSWORD);

    submitTwiceInOneTick(screen.getByTestId('reset-password-form'));

    await screen.findByTestId('reset-password-error');
    expect(requests).toEqual(['POST /api/auth/reset-password']);
  });

  it('activates once', async () => {
    const requests = stubNetwork(() => success({ requiresTwoFactor: false, user: SIGNED_IN_USER }));
    await renderForm('en', <ActivationForm />);
    fillActivation(PASSWORD);

    submitTwiceInOneTick(screen.getByTestId('activate-form'));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
    expect(writesOf(requests)).toEqual(['POST /api/auth/activate']);
  });

  it('asks for one new activation code on two clicks in one tick', async () => {
    const requests = stubNetwork(() => success({ message: 'sent' }));
    const { successToasts, message } = await renderForm('en', <ActivationForm />);
    change('activate-email-input', EMAIL);

    clickTwiceInOneTick(screen.getByTestId('resend-button'));

    await waitFor(() => expect(successToasts()).toEqual([message('toast.success.resendSuccess')]));
    expect(writesOf(requests)).toEqual(['POST /api/auth/resend-activation']);
  });
});
