// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { expectFocusKeptThroughRequest, heldAnswer, unreachable } from '@/tests/busyControls';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ResetPasswordForm } from '../ResetPasswordForm';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('email=layla@example.com'),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('a', props, children),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const CODE = '123456';

/**
 * How a held reset ends, and what the code field holds afterwards. The code
 * goes only when the server's answer means it can never work.
 */
const ENDINGS = [
  [
    'a code the server found wrong, expired or locked',
    ErrorCode.PASSWORD_RESET_CODE_INVALID,
    400,
    '',
  ],
  ['a code the server took before finding no account', ErrorCode.USER_NOT_FOUND_FOR_RESET, 404, ''],
  ['a password the server refuses', ErrorCode.VALIDATION_ERROR, 400, CODE],
  ['too many attempts', ErrorCode.RATE_LIMIT_EXCEEDED, 429, CODE],
  ['a server fault', ErrorCode.INTERNAL_ERROR, 500, CODE],
] as const;

/** The form with every field filled and the reset request held until settled. */
async function filledForm(locale: AppLocale) {
  const held = heldAnswer();
  stubNetwork((request) => (request.method === 'GET' ? success({}) : held.answer));
  const form = await renderForm(locale, <ResetPasswordForm />);
  const code = await screen.findByTestId('reset-password-code-input');
  fireEvent.change(code, { target: { value: CODE } });
  fireEvent.change(screen.getByTestId('reset-password-password-input'), {
    target: { value: 'Passw0rdLayla' },
  });
  fireEvent.change(screen.getByTestId('reset-password-confirmPassword-input'), {
    target: { value: 'Passw0rdLayla' },
  });
  return { ...form, code, settle: held.settle };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the reset password form while its request runs in %s', (locale) => {
  it.each(ENDINGS)(
    'keeps focus on the submit button after %s, and the code field then holds what it should',
    async (_name, errorCode, status, codeAfterwards) => {
      const { settle, code } = await filledForm(locale);
      const submit = screen.getByTestId('reset-password-submit');
      submit.focus();

      fireEvent.click(submit);

      await expectFocusKeptThroughRequest(submit, () =>
        settle(() => refusalWith(status, errorCode)),
      );
      await waitFor(() => expect(screen.queryByTestId('reset-password-error')).not.toBeNull());
      expect(code).toHaveProperty('value', codeAfterwards);
    },
  );

  it('keeps focus on the submit button and the typed code when the server cannot be reached', async () => {
    const { settle, code, message } = await filledForm(locale);
    const submit = screen.getByTestId('reset-password-submit');
    submit.focus();

    fireEvent.click(submit);

    await expectFocusKeptThroughRequest(submit, () => settle(unreachable));
    await waitFor(() =>
      expect(screen.getByTestId('reset-password-error').textContent).toBe(
        message('toast.error.networkError'),
      ),
    );
    expect(code).toHaveProperty('value', CODE);
  });

  it('keeps focus in the code field the form was sent from when the reset is refused', async () => {
    const { settle, code } = await filledForm(locale);
    code.focus();

    fireEvent.submit(code);

    await expectFocusKeptThroughRequest(code, () =>
      settle(() => refusalWith(400, ErrorCode.PASSWORD_RESET_CODE_INVALID)),
    );
  });
});
