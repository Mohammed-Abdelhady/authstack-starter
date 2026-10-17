// @vitest-environment jsdom
import { acceptActivation, change, fillActivation, navigation } from './registrationHarness';
import * as React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  renderForm,
  registerFormTestLifecycle,
  descriptions,
} from '@/tests/serverRejectionHarness';
import { ActivationForm } from '@/modules/auth/components/ActivationForm';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('activation validation in %s', (locale) => {
  it.each([
    ['Aa1' + 'é'.repeat(34), 71],
    ['Aa1' + 'é'.repeat(34) + 'x', 72],
    ['Aa123456', 8],
    ['Aa1😀😀x', 12],
  ])('accepts server-valid password %s (%i bytes)', async (password) => {
    const bodies: unknown[] = [];
    acceptActivation(bodies);
    await renderForm(locale, <ActivationForm />);
    fillActivation(password);
    fireEvent.submit(screen.getByTestId('activate-form'));
    await waitFor(() =>
      expect(bodies).toEqual([
        { email: 'layla@example.com', code: '000000', name: 'Layla Haddad', password },
      ]),
    );
  });

  it.each([
    ['Aa1' + 'é'.repeat(35), 'tooLong'],
    ['a1234567', 'uppercase'],
    ['A1234567', 'lowercase'],
    ['Abcdefgh', 'number'],
    ['Aa12345', 'min'],
    ['Aa1😀😀', 'min'],
    ['a1' + '😀'.repeat(5), 'uppercase'],
    ['', 'required'],
  ])('rejects password %s with its localized rule and no write', async (password, key) => {
    const bodies: unknown[] = [];
    acceptActivation(bodies);
    const form = await renderForm(locale, <ActivationForm />);
    fillActivation(password);
    fireEvent.submit(screen.getByTestId('activate-form'));
    const input = screen.getByTestId('activate-password-input');
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    expect(descriptions(input)).toEqual([form.message(`auth.passwordRules.errors.${key}`)]);
    expect(bodies).toEqual([]);
  });

  it.each(['София 2. Иванова’', 'Li', 'L'.repeat(79), 'L'.repeat(80), '𐐀'.repeat(80)])(
    'accepts the server name %s',
    async (name) => {
      const bodies: unknown[] = [];
      acceptActivation(bodies);
      await renderForm(locale, <ActivationForm />);
      fillActivation('Passw0rdLayla', name);
      fireEvent.submit(screen.getByTestId('activate-form'));
      await waitFor(() =>
        expect(bodies).toEqual([
          { email: 'layla@example.com', code: '000000', name, password: 'Passw0rdLayla' },
        ]),
      );
    },
  );

  it('sends a trimmed NFC name to activation', async () => {
    const bodies: unknown[] = [];
    acceptActivation(bodies);
    await renderForm(locale, <ActivationForm />);
    fillActivation('Passw0rdLayla', '  Jose\u0301  ');
    fireEvent.submit(screen.getByTestId('activate-form'));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          email: 'layla@example.com',
          code: '000000',
          name: 'Jos\u00e9',
          password: 'Passw0rdLayla',
        },
      ]),
    );
  });

  it.each([
    '',
    ' ',
    'L',
    'L'.repeat(101),
    '<Layla>',
    'La\u0004yla',
    // Every line-break and invisible character the rule refuses:
    // Rows a text input can carry. The DOM strips \n and \r\n from an
    // input's value before the form sees it, so those two names are
    // asserted by shared/core/src/validations/string/identity.test.ts.
    'Layla\tHaddad',
    'Bob\u2028Lee',
    'Bo\ufeffb',
    'Bo\u000b\u000cb',
  ])('rejects the server-invalid name %s without a write', async (name) => {
    const bodies: unknown[] = [];
    acceptActivation(bodies);
    await renderForm(locale, <ActivationForm />);
    fillActivation('Passw0rdLayla', name);
    fireEvent.submit(screen.getByTestId('activate-form'));
    await waitFor(() =>
      expect(screen.getByTestId('activate-name-input').getAttribute('aria-invalid')).toBe('true'),
    );
    expect(bodies).toEqual([]);
  });

  it('requires an exact password confirmation without trimming pasted spaces', async () => {
    const bodies: unknown[] = [];
    acceptActivation(bodies);
    const form = await renderForm(locale, <ActivationForm />);
    fillActivation('Aa123456 ');
    change('activate-confirm-password-input', 'Aa123456');
    fireEvent.submit(screen.getByTestId('activate-form'));
    await screen.findByText(form.message('auth.activate.errors.passwordMismatch'));
    expect(bodies).toEqual([]);
    change('activate-confirm-password-input', 'Aa123456 ');
    fireEvent.submit(screen.getByTestId('activate-form'));
    await waitFor(() =>
      expect(bodies).toEqual([
        { email: 'layla@example.com', code: '000000', name: 'Layla Haddad', password: 'Aa123456 ' },
      ]),
    );
  });
});
