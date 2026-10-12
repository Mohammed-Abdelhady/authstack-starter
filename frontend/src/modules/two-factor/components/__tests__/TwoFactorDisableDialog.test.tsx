// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import {
  descriptions,
  makeStore,
  registerFormTestLifecycle,
  renderForm,
  refusalWith,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { TwoFactorDisableDialog } from '../TwoFactorDisableDialog';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import type { SignedInUser } from '@/modules/auth/types/auth.types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const DISABLE = 'POST /api/auth/2fa/disable';
const USER: SignedInUser = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};

registerFormTestLifecycle();

/** Answers the turn-off route through `respond` and keeps every body it was sent. */
function recordDisable(respond: () => Response = () => success({ message: 'off' })) {
  const bodies: unknown[] = [];
  const requests = stubNetwork(async (request, path) => {
    if (path === '/api/user/profile') return success(USER);
    if (path !== '/api/auth/2fa/disable') throw new Error(`Unexpected path: ${path}`);
    bodies.push(await request.json());
    return respond();
  });
  return { bodies, requests, writes: () => requests.filter((request) => request === DISABLE) };
}

async function openDialog(hasPassword: boolean, locale: AppLocale = 'en') {
  const onOpenChange = vi.fn();
  const store = makeStore();
  store.dispatch(loginFulfilled(USER));
  const view = await renderForm(
    locale,
    <TwoFactorDisableDialog open onOpenChange={onOpenChange} hasPassword={hasPassword} />,
    store,
  );
  const code = () => screen.getByRole('textbox', { name: view.message('auth.twoFactor.code') });
  const recoveryCode = () =>
    screen.getByRole('textbox', { name: view.message('auth.twoFactor.recoveryCode') });
  const password = () => screen.getByLabelText(view.message('settings.twoFactor.disable.password'));
  /** A click moves the focus to the button first, as a pointer does. */
  const submit = () => {
    const button = screen.getByRole('button', {
      name: view.message('settings.twoFactor.disable.submit'),
    });
    button.focus();
    fireEvent.click(button);
  };
  const useRecoveryCode = () =>
    fireEvent.click(
      screen.getByRole('button', { name: view.message('auth.twoFactor.useRecoveryCode') }),
    );
  return { ...view, onOpenChange, code, recoveryCode, password, submit, useRecoveryCode };
}

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

describe('turning two-step verification off', () => {
  it('sends the password with the code for an account that has a password', async () => {
    const { bodies } = recordDisable();
    const dialog = await openDialog(true);
    type(dialog.password(), 'Passw0rdLayla');
    type(dialog.code(), '123456');

    dialog.submit();

    await waitFor(() => expect(dialog.onOpenChange.mock.calls).toEqual([[false]]));
    expect(bodies).toEqual([{ code: '123456', password: 'Passw0rdLayla' }]);
    expect(dialog.successToasts()).toEqual([dialog.message('settings.twoFactor.disable.success')]);
  });

  it('sends the password with a recovery code', async () => {
    const { bodies } = recordDisable();
    const dialog = await openDialog(true);
    type(dialog.password(), 'Passw0rdLayla');
    dialog.useRecoveryCode();
    type(dialog.recoveryCode(), 'K3M7QRTVWX');

    dialog.submit();

    await waitFor(() => expect(dialog.onOpenChange.mock.calls).toEqual([[false]]));
    expect(bodies).toEqual([{ recoveryCode: 'K3M7QRTVWX', password: 'Passw0rdLayla' }]);
  });

  it('sends the code alone for an account without a password', async () => {
    const { bodies } = recordDisable();
    const dialog = await openDialog(false);
    type(dialog.code(), '123456');

    dialog.submit();

    await waitFor(() => expect(dialog.onOpenChange.mock.calls).toEqual([[false]]));
    expect(bodies).toEqual([{ code: '123456' }]);
    expect(
      screen.queryByLabelText(dialog.message('settings.twoFactor.disable.password')),
    ).toBeNull();
  });

  it('keeps the spaces of a password as typed', async () => {
    const { bodies } = recordDisable();
    const dialog = await openDialog(true);
    type(dialog.password(), ' pass word ');
    type(dialog.code(), '123456');

    dialog.submit();

    await waitFor(() => expect(bodies).toEqual([{ code: '123456', password: ' pass word ' }]));
  });

  it.each([
    'en',
    'ar', // feature:locale-ar
  ] as const)('asks for the missing password and sends nothing in %s', async (locale) => {
    const { writes } = recordDisable();
    const dialog = await openDialog(true, locale);
    type(dialog.code(), '123456');

    dialog.submit();

    await waitFor(() =>
      expect(descriptions(dialog.password())).toEqual([
        dialog.message('settings.password.currentPasswordRequired'),
      ]),
    );
    expect(dialog.password().getAttribute('aria-invalid')).toBe('true');
    expect(dialog.code().getAttribute('aria-invalid')).toBe('false');
    expect(document.activeElement).toBe(dialog.password());
    expect(writes()).toEqual([]);
    expect(dialog.onOpenChange.mock.calls).toEqual([]);
  });

  it('marks both fields when both are empty', async () => {
    const { writes } = recordDisable();
    const dialog = await openDialog(true);

    dialog.submit();

    await waitFor(() =>
      expect(descriptions(dialog.code())).toEqual([
        dialog.message('auth.twoFactor.answerRequired'),
      ]),
    );
    expect(descriptions(dialog.password())).toEqual([
      dialog.message('settings.password.currentPasswordRequired'),
    ]);
    expect(writes()).toEqual([]);
  });
});

describe('where the turn-off dialog puts the focus', () => {
  it('starts on the password when the account has one', async () => {
    recordDisable();
    const dialog = await openDialog(true);

    expect(document.activeElement).toBe(dialog.password());
  });

  it('starts on the code when the account has no password', async () => {
    recordDisable();
    const dialog = await openDialog(false);

    expect(document.activeElement).toBe(dialog.code());
  });

  it('moves to the recovery code when the person switches to it', async () => {
    recordDisable();
    const dialog = await openDialog(true);

    dialog.useRecoveryCode();

    expect(document.activeElement).toBe(dialog.recoveryCode());
  });
});

describe('a refused turn-off names the field that was wrong', () => {
  it.each([
    [ErrorCode.INVALID_CURRENT_PASSWORD, 400],
    [ErrorCode.REAUTH_REQUIRED, 401],
  ] as const)('puts %s on the password', async (errorCode, status) => {
    const { requests } = recordDisable(() => refusalWith(status, errorCode));
    const dialog = await openDialog(true);
    type(dialog.password(), 'WrongPassw0rd');
    type(dialog.code(), '123456');

    dialog.submit();

    await waitFor(() =>
      expect(descriptions(dialog.password())).toEqual([
        dialog.message(`errors.codes.${errorCode}`),
      ]),
    );
    expect(dialog.password().getAttribute('aria-invalid')).toBe('true');
    expect(dialog.code().getAttribute('aria-invalid')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(dialog.password()));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(dialog.onOpenChange.mock.calls).toEqual([]);
    if (status === 401) {
      await waitFor(() => expect(requests).toContain('GET /api/user/profile'));
      expect(dialog.store.getState().auth.isAuthenticated).toBe(true);
    }
  });

  it('puts a wrong code on the code field', async () => {
    recordDisable(() => refusalWith(401, ErrorCode.TWO_FACTOR_CODE_INVALID));
    const dialog = await openDialog(true);
    type(dialog.password(), 'Passw0rdLayla');
    type(dialog.code(), '654321');

    dialog.submit();

    await waitFor(() =>
      expect(descriptions(dialog.code())).toEqual([
        dialog.message('errors.codes.TWO_FACTOR_CODE_INVALID'),
      ]),
    );
    expect(dialog.code().getAttribute('aria-invalid')).toBe('true');
    expect(dialog.password().getAttribute('aria-invalid')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(dialog.code()));
    expect(dialog.onOpenChange.mock.calls).toEqual([]);
  });

  it('puts a wrong recovery code on the recovery code field', async () => {
    recordDisable(() => refusalWith(401, ErrorCode.TWO_FACTOR_CODE_INVALID));
    const dialog = await openDialog(true);
    type(dialog.password(), 'Passw0rdLayla');
    dialog.useRecoveryCode();
    type(dialog.recoveryCode(), 'B8N2PLHZDF');

    dialog.submit();

    await waitFor(() =>
      expect(descriptions(dialog.recoveryCode())).toEqual([
        dialog.message('errors.codes.TWO_FACTOR_CODE_INVALID'),
      ]),
    );
    await waitFor(() => expect(document.activeElement).toBe(dialog.recoveryCode()));
  });

  it('shows a failure that belongs to no field above the form', async () => {
    recordDisable(() => refusalWith(500, ErrorCode.INTERNAL_ERROR));
    const dialog = await openDialog(true);
    type(dialog.password(), 'Passw0rdLayla');
    type(dialog.code(), '123456');

    dialog.submit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(dialog.message('errors.codes.INTERNAL_ERROR'));
    expect(dialog.password().getAttribute('aria-invalid')).toBe('false');
    expect(dialog.code().getAttribute('aria-invalid')).toBe('false');
  });

  it('clears what was typed when the dialog is dismissed', async () => {
    recordDisable();
    const dialog = await openDialog(true);
    type(dialog.password(), 'Passw0rdLayla');
    type(dialog.code(), '123456');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(dialog.onOpenChange.mock.calls).toEqual([[false]]));
    expect(dialog.password()).toHaveProperty('value', '');
    expect(dialog.code()).toHaveProperty('value', '');
  });
});
