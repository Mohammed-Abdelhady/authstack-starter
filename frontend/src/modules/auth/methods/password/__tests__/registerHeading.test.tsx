// @vitest-environment jsdom
import { AUTH_METHODS, navigation } from './registrationHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { RegisterPage } from '../RegisterPage';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

function unreachable(): Response {
  throw new TypeError('Failed to fetch');
}

/** The level one headings on the page, by their text. */
function pageHeadings(): Array<string | null> {
  return screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent);
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the heading of the register page in %s', (locale) => {
  it('is on the page while the sign-in options could not be loaded', async () => {
    stubNetwork(unreachable);
    const { message } = await renderForm(locale, <RegisterPage />);

    await screen.findByRole('alert');

    expect(pageHeadings()).toEqual([message('auth.register.title')]);
    expect(screen.queryByTestId('register-form')).toBeNull();
  });

  it('is the only page heading above the form', async () => {
    stubNetwork(() => success(AUTH_METHODS));
    const { message } = await renderForm(locale, <RegisterPage />);

    await screen.findByTestId('register-form');

    expect(pageHeadings()).toEqual([message('auth.register.title')]);
  });

  it('is on the page where no account is made with a password', async () => {
    stubNetwork(() =>
      success({ methods: { password: false, magicLink: true, passkeys: false, oauth: [] } }),
    );
    const { message } = await renderForm(locale, <RegisterPage />);

    await screen.findByTestId('register-no-password-hint');

    expect(pageHeadings()).toEqual([message('auth.register.title')]);
  });
});
