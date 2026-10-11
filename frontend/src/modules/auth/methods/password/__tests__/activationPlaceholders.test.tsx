// @vitest-environment jsdom
import { acceptActivation, navigation } from './registrationHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ActivationForm } from '@/modules/auth/components/ActivationForm';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('the password fields of the activation form in %s', (locale) => {
  it('carry the placeholder every other password field has', async () => {
    acceptActivation([]);
    const { message } = await renderForm(locale, <ActivationForm />);
    const placeholderOf = (testId: string) =>
      screen.getByTestId(testId).getAttribute('placeholder');

    expect({
      password: placeholderOf('activate-password-input'),
      confirmPassword: placeholderOf('activate-confirm-password-input'),
    }).toEqual({
      password: message('common.passwordPlaceholder'),
      confirmPassword: message('common.passwordPlaceholder'),
    });
  });
});
