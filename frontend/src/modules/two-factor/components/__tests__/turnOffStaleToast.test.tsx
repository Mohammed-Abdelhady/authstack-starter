// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import {
  descriptions,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { sendRefusedThenAgain, toastOrder } from '@/tests/staleToast';
import { TwoFactorDisableDialog } from '../TwoFactorDisableDialog';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const RIGHT_PASSWORD = 'Passw0rdLayla';
const RIGHT_CODE = '123456';

/** Answers as the server does: the password is checked first, then the code. */
function checkPasswordThenCode() {
  return stubNetwork(async (request) => {
    if (request.method === 'GET') return success({});
    const body: { password?: string; code?: string } = await request.json();
    if (body.password !== RIGHT_PASSWORD) {
      return refusalWith(400, ErrorCode.INVALID_CURRENT_PASSWORD);
    }
    return body.code === RIGHT_CODE
      ? success({ message: 'off' })
      : refusalWith(401, ErrorCode.TWO_FACTOR_CODE_INVALID);
  });
}

async function openDialog(locale: AppLocale) {
  const view = await renderForm(
    locale,
    <TwoFactorDisableDialog open onOpenChange={vi.fn()} hasPassword />,
  );
  const password = () => screen.getByLabelText(view.message('settings.twoFactor.disable.password'));
  const code = () => screen.getByRole('textbox', { name: view.message('auth.twoFactor.code') });
  const send = (passwordValue: string, codeValue: string) => () => {
    fireEvent.change(password(), { target: { value: passwordValue } });
    fireEvent.change(code(), { target: { value: codeValue } });
    fireEvent.submit(screen.getByTestId('two-factor-disable-form'));
  };
  const isIdle = () => !password().hasAttribute('disabled');
  return { ...view, password, code, send, isIdle };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the toast of a refused turn-off in %s', (locale) => {
  it('is gone once the password is right and the answer is about the code', async () => {
    checkPasswordThenCode();
    const dialog = await openDialog(locale);

    dialog.send('WrongPassw0rd', '000000')();
    await waitFor(() => {
      expect(dialog.errorToasts()).toEqual([
        dialog.message('errors.codes.INVALID_CURRENT_PASSWORD'),
      ]);
    });
    await waitFor(() => {
      expect(dialog.isIdle()).toBe(true);
    });
    dialog.send(RIGHT_PASSWORD, '000000')();

    await waitFor(() => {
      expect(descriptions(dialog.code())).toEqual([
        dialog.message('errors.codes.TWO_FACTOR_CODE_INVALID'),
      ]);
    });
    expect(toastOrder()).toEqual(['error', 'dismiss']);
  });

  it('is taken down once, before the success is announced', async () => {
    checkPasswordThenCode();
    const dialog = await openDialog(locale);
    let attempt = 0;
    const wrongThenRight = () => {
      attempt += 1;
      dialog.send(attempt === 1 ? 'WrongPassw0rd' : RIGHT_PASSWORD, RIGHT_CODE)();
    };

    await sendRefusedThenAgain(wrongThenRight, dialog.isIdle);

    await waitFor(() => {
      expect(dialog.successToasts()).toEqual([
        dialog.message('settings.twoFactor.disable.success'),
      ]);
    });
    expect(toastOrder()).toEqual(['error', 'dismiss', 'success']);
  });

  it('dismisses nothing when the first answer is accepted', async () => {
    checkPasswordThenCode();
    const dialog = await openDialog(locale);

    dialog.send(RIGHT_PASSWORD, RIGHT_CODE)();

    await waitFor(() => {
      expect(toastOrder()).toEqual(['success']);
    });
  });
});
