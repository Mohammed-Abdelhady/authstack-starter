// @vitest-environment jsdom
import { change, navigation } from './registrationHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import { unreachable } from '@/tests/busyControls';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
} from '@/tests/serverRejectionHarness';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import { ResetPasswordForm } from '../ResetPasswordForm';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
  navigation.push.mockClear();
  navigation.replace.mockClear();
});

const FORMS = {
  'forgot password': {
    search: '',
    page: <ForgotPasswordForm />,
    alert: 'forgot-password-error',
    send: () => {
      change('forgot-password-email-input', 'layla@example.com');
      fireEvent.submit(screen.getByTestId('forgot-password-form'));
    },
  },
  'reset password': {
    search: 'email=layla@example.com',
    page: <ResetPasswordForm />,
    alert: 'reset-password-error',
    send: () => {
      change('reset-password-code-input', '123456');
      change('reset-password-password-input', 'NewPassw0rdLayla');
      change('reset-password-confirmPassword-input', 'NewPassw0rdLayla');
      fireEvent.submit(screen.getByTestId('reset-password-form'));
    },
  },
} as const;

/** How each failure ends, and the catalogue message the form shows for it. */
const FAILURES = [
  [
    'too many requests',
    () => refusalWith(429, ErrorCode.RATE_LIMIT_EXCEEDED),
    'errors.codes.RATE_LIMIT_EXCEEDED',
  ],
  [
    'a server error',
    () => refusalWith(500, ErrorCode.INTERNAL_ERROR),
    'errors.codes.INTERNAL_ERROR',
  ],
  [
    'a code this build does not know',
    () => refusalWith(409, 'SOMETHING_NEW'),
    'errors.codes.CONFLICT',
  ],
  ['no connection', unreachable, 'toast.error.networkError'],
] as const;

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the reason a password form shows for a failed request in %s', (locale) => {
  describe.each(['forgot password', 'reset password'] as const)('%s', (formName) => {
    it.each(FAILURES)(
      'is the catalogue message for %s, said once, and never the server text',
      async (_what, answer, key) => {
        const form = FORMS[formName];
        navigation.search = form.search;
        stubNetwork(answer);
        const view = await renderForm(locale, form.page);

        form.send();

        const alert = await screen.findByTestId(form.alert);
        expect(alert.textContent).toBe(view.message(key));
        expect(view.errorToasts()).toEqual([]);
        expect(document.body.textContent).not.toContain(SERVER_TEXT);
        expect(navigation.push).not.toHaveBeenCalled();
      },
    );
  });
});
