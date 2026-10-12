// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { ErrorCode } from '@app/core';
import {
  SERVER_TEXT,
  descriptions,
  refusalWith,
  refuseWrites,
  renderForm,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ChangePasswordCard } from '../ChangePasswordCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** The card is not rendered where password sign-in is off. */
const AUTH_METHODS = { methods: { password: true } };

async function submitPasswordChange(locale: AppLocale) {
  const form = await renderForm(locale, <ChangePasswordCard />);
  await screen.findByTestId('change-password-form');
  const label = (key: string) => form.message(`settings.password.${key}`);
  const currentPassword = screen.getByLabelText(label('currentPassword'));
  const newPassword = screen.getByLabelText(label('newPassword'));

  fireEvent.change(currentPassword, { target: { value: 'OldPassw0rdLayla' } });
  fireEvent.change(newPassword, { target: { value: 'NewPassw0rdLayla' } });
  fireEvent.change(screen.getByLabelText(label('confirmPassword')), {
    target: { value: 'NewPassw0rdLayla' },
  });
  fireEvent.click(screen.getByRole('button', { name: label('submit') }));

  return { ...form, currentPassword, newPassword };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('ChangePasswordCard refused by the server in %s', (locale) => {
  it('marks and focuses the rejected field and raises no toast', async () => {
    refuseWrites(['newPassword', 'nickname'], AUTH_METHODS);

    const { currentPassword, newPassword, fieldMessage, errorToasts } =
      await submitPasswordChange(locale);

    await waitFor(() => {
      expect(newPassword.getAttribute('aria-invalid')).toBe('true');
    });
    expect(descriptions(newPassword)).toEqual([fieldMessage]);
    expect(currentPassword.getAttribute('aria-invalid')).toBe('false');
    // The field takes the focus once the form is enabled again.
    await waitFor(() => {
      expect(document.activeElement).toBe(newPassword);
    });
    // The marked field says it. No toast repeats it.
    expect(errorToasts()).toEqual([]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it.each([
    ['a wrong current password', 400, ErrorCode.INVALID_CURRENT_PASSWORD, 'currentPassword'],
    ['a new password equal to the current one', 400, ErrorCode.SAME_PASSWORD, 'newPassword'],
  ] as const)(
    'marks and focuses the field for %s, with the reason, and raises no toast',
    async (_what, status, code, field) => {
      stubNetwork((request) =>
        request.method === 'GET' ? success(AUTH_METHODS) : refusalWith(status, code),
      );

      const form = await submitPasswordChange(locale);
      const refused = form[field];
      const other = field === 'currentPassword' ? form.newPassword : form.currentPassword;

      await waitFor(() => expect(refused.getAttribute('aria-invalid')).toBe('true'));
      expect(descriptions(refused)).toEqual([form.message(`errors.codes.${code}`)]);
      expect(other.getAttribute('aria-invalid')).toBe('false');
      await waitFor(() => expect(document.activeElement).toBe(refused));
      expect(screen.queryByTestId('change-password-error')).toBeNull();
      expect(form.errorToasts()).toEqual([]);
      expect(document.body.textContent).not.toContain(SERVER_TEXT);
    },
  );

  it('says a refusal about no field in the alert of the form, once', async () => {
    stubNetwork((request) =>
      request.method === 'GET'
        ? success(AUTH_METHODS)
        : refusalWith(429, ErrorCode.RATE_LIMIT_EXCEEDED),
    );

    const form = await submitPasswordChange(locale);

    const alert = await screen.findByTestId('change-password-error');
    expect(alert.textContent).toBe(form.message('errors.codes.RATE_LIMIT_EXCEEDED'));
    expect(form.currentPassword.getAttribute('aria-invalid')).toBe('false');
    expect(form.errorToasts()).toEqual([]);
  });

  it('tells the browser which password each field holds', async () => {
    refuseWrites([], AUTH_METHODS);

    const { message } = await renderForm(locale, <ChangePasswordCard />);
    await screen.findByTestId('change-password-form');
    const purposeOf = (key: string) =>
      screen.getByLabelText(message(`settings.password.${key}`)).getAttribute('autocomplete');

    expect({
      currentPassword: purposeOf('currentPassword'),
      newPassword: purposeOf('newPassword'),
      confirmPassword: purposeOf('confirmPassword'),
    }).toEqual({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      confirmPassword: 'new-password',
    });
  });
});
