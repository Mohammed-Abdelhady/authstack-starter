// @vitest-environment jsdom
import { change, navigation, SIGNED_IN_USER } from './registrationHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { fieldNames } from '@/modules/auth/__tests__/fieldNames';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import { PasswordSignInForm } from '../PasswordSignInForm';
import { ResetPasswordForm } from '../ResetPasswordForm';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

/** Keeps the body of every write, keyed by `METHOD /path`. */
function recordWrites(answer: unknown) {
  const writes: Array<[string, unknown]> = [];
  stubNetwork(async (request, path) => {
    if (request.method === 'GET') return success({});
    writes.push([`${request.method} ${path}`, await request.json()]);
    return success(answer);
  });
  return writes;
}

// A field the form's schema does not name is dropped before the request is
// built. Each test lists the fields on screen and the body that must carry them.
describe('every field on a password form reaches its request', () => {
  it('signs in with the address and the password', async () => {
    const writes = recordWrites({ requiresTwoFactor: false, user: SIGNED_IN_USER });
    await renderForm('en', <PasswordSignInForm redirect={null} isOnlyMethod />);
    const form = screen.getByTestId('login-form');
    expect(fieldNames(form)).toEqual(['email', 'password']);
    change('login-email-input', 'layla@example.com');
    change('login-password-input', 'Passw0rdLayla');

    fireEvent.submit(form);

    await waitFor(() =>
      expect(writes).toEqual([
        ['POST /api/auth/login', { email: 'layla@example.com', password: 'Passw0rdLayla' }],
      ]),
    );
  });

  it('asks for a reset with the address', async () => {
    const writes = recordWrites({ message: 'sent' });
    await renderForm('en', <ForgotPasswordForm />);
    const form = screen.getByTestId('forgot-password-form');
    expect(fieldNames(form)).toEqual(['email']);
    change('forgot-password-email-input', 'layla@example.com');

    fireEvent.submit(form);

    await waitFor(() =>
      expect(writes).toEqual([['POST /api/auth/forgot-password', { email: 'layla@example.com' }]]),
    );
  });

  it('resets with the address, the code and the new password', async () => {
    navigation.search = 'email=layla@example.com';
    const writes = recordWrites({ message: 'reset' });
    await renderForm('en', <ResetPasswordForm />);
    const form = screen.getByTestId('reset-password-form');
    expect(fieldNames(form)).toEqual(['email', 'code', 'password', 'confirmPassword']);
    change('reset-password-code-input', '123456');
    change('reset-password-password-input', 'NewPassw0rdLayla');
    change('reset-password-confirmPassword-input', 'NewPassw0rdLayla');

    fireEvent.submit(form);

    // The confirmation is compared on the page and is not part of the request.
    await waitFor(() =>
      expect(writes).toEqual([
        [
          'POST /api/auth/reset-password',
          { email: 'layla@example.com', code: '123456', newPassword: 'NewPassw0rdLayla' },
        ],
      ]),
    );
  });
});
