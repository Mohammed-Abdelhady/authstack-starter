// @vitest-environment jsdom
import { change, navigation } from './registrationHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  descriptions,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { PasswordSignInForm } from '../PasswordSignInForm';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

/** The form beside something else that can take the focus, as on the sign-in page. */
async function renderBesideAnotherControl(locale: AppLocale) {
  const requests = stubNetwork(() => success({}));
  const view = await renderForm(
    locale,
    <>
      <PasswordSignInForm redirect={null} isOnlyMethod />
      <input data-testid="other-form-field" />
    </>,
  );
  return {
    ...view,
    requests,
    email: screen.getByRole('textbox', { name: view.message('auth.login.email') }),
    password: screen.getByLabelText(view.message('auth.login.password')),
  };
}

/** The ids a field names in `aria-describedby` that no element on the page has. */
function missingDescriptions(field: HTMLElement): string[] {
  return (field.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '' && document.getElementById(id) === null);
}

/** Moves the focus the way Tab or a click does, and lets validation settle. */
async function moveFocus(from: HTMLElement, to: HTMLElement) {
  await act(async () => {
    from.focus();
    to.focus();
  });
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('password sign-in validation in %s', (locale) => {
  it('says nothing when the focus leaves an empty field for another form', async () => {
    const { email, password } = await renderBesideAnotherControl(locale);

    await moveFocus(email, screen.getByTestId('other-form-field'));
    await moveFocus(password, screen.getByTestId('other-form-field'));

    expect(email.getAttribute('aria-invalid')).toBe('false');
    expect(password.getAttribute('aria-invalid')).toBe('false');
    expect(descriptions(email)).toEqual([]);
    expect(descriptions(password)).toEqual([]);
  });

  it('names a wrong value once the field is left', async () => {
    const { email, password, message } = await renderBesideAnotherControl(locale);
    change('login-email-input', 'layla@');
    change('login-password-input', 'abc');

    await moveFocus(email, password);
    await moveFocus(password, screen.getByTestId('other-form-field'));

    await waitFor(() =>
      expect(descriptions(email)).toEqual([message('auth.login.errors.emailInvalid')]),
    );
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(descriptions(password)).toEqual([message('auth.login.errors.passwordMinLength')]);
  });

  it('takes the message away when the wrong value is erased before leaving', async () => {
    const { email, message } = await renderBesideAnotherControl(locale);
    const other = screen.getByTestId('other-form-field');
    change('login-email-input', 'layla@');
    await moveFocus(email, other);
    await waitFor(() =>
      expect(descriptions(email)).toEqual([message('auth.login.errors.emailInvalid')]),
    );

    change('login-email-input', '');
    await moveFocus(email, other);

    expect(descriptions(email)).toEqual([]);
    expect(email.getAttribute('aria-invalid')).toBe('false');
  });

  it('keeps both messages when the form is submitted from the empty password field', async () => {
    const { email, password, message, requests } = await renderBesideAnotherControl(locale);
    const form = screen.getByTestId('login-form');
    if (!(form instanceof HTMLFormElement)) throw new Error('the sign-in form is not a form');
    // Enter in a field submits the form and leaves the focus where it was.
    await moveFocus(email, password);

    act(() => form.requestSubmit());

    await waitFor(() => expect(document.activeElement).toBe(email));
    await waitFor(() =>
      expect(descriptions(password)).toEqual([message('auth.login.errors.passwordRequired')]),
    );
    expect(descriptions(email)).toEqual([message('auth.login.errors.emailRequired')]);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(missingDescriptions(email)).toEqual([]);
    expect(missingDescriptions(password)).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('keeps the password message when a wrong address was erased before the submit', async () => {
    const { email, password, message } = await renderBesideAnotherControl(locale);
    const form = screen.getByTestId('login-form');
    if (!(form instanceof HTMLFormElement)) throw new Error('the sign-in form is not a form');
    change('login-email-input', 'layla@');
    await moveFocus(email, password);
    await waitFor(() =>
      expect(descriptions(email)).toEqual([message('auth.login.errors.emailInvalid')]),
    );
    change('login-email-input', '');

    act(() => form.requestSubmit());

    await waitFor(() => expect(document.activeElement).toBe(email));
    await waitFor(() =>
      expect(descriptions(password)).toEqual([message('auth.login.errors.passwordRequired')]),
    );
    expect(descriptions(email)).toEqual([message('auth.login.errors.emailRequired')]);
  });

  it('keeps the password message when a short password was erased before the submit', async () => {
    const { email, password, message } = await renderBesideAnotherControl(locale);
    const form = screen.getByTestId('login-form');
    if (!(form instanceof HTMLFormElement)) throw new Error('the sign-in form is not a form');
    change('login-password-input', 'abc');
    await moveFocus(password, email);
    await waitFor(() =>
      expect(descriptions(password)).toEqual([message('auth.login.errors.passwordMinLength')]),
    );
    await moveFocus(email, password);
    change('login-password-input', '');

    act(() => form.requestSubmit());

    await waitFor(() => expect(document.activeElement).toBe(email));
    await waitFor(() =>
      expect(descriptions(password)).toEqual([message('auth.login.errors.passwordRequired')]),
    );
    expect(descriptions(email)).toEqual([message('auth.login.errors.emailRequired')]);
  });

  it('keeps the message of a submitted empty field when the focus moves on', async () => {
    const { email, message } = await renderBesideAnotherControl(locale);
    fireEvent.submit(screen.getByTestId('login-form'));
    await waitFor(() =>
      expect(descriptions(email)).toEqual([message('auth.login.errors.emailRequired')]),
    );

    await moveFocus(email, screen.getByTestId('other-form-field'));

    expect(descriptions(email)).toEqual([message('auth.login.errors.emailRequired')]);
  });
});
