// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  SERVER_TEXT,
  descriptions,
  refuseWrites,
  renderForm,
  registerFormTestLifecycle,
} from '@/tests/serverRejectionHarness';
import { ChangePasswordCard } from '../ChangePasswordCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** The card is not rendered where password sign-in is off. */
const AUTH_METHODS = { methods: { password: true } };

async function submitPasswordChange(locale: AppLocale) {
  const form = await renderForm(locale, <ChangePasswordCard />);
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

  it('tells the browser which password each field holds', async () => {
    refuseWrites([], AUTH_METHODS);

    const { message } = await renderForm(locale, <ChangePasswordCard />);
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
