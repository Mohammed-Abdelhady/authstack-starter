// @vitest-environment jsdom
import { AUTH_METHODS, change, navigation } from './registrationHarness';
import * as React from 'react';
import { ErrorCode } from '@app/core';
import { describe, expect, it, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  descriptions,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ResetPasswordForm } from '../ResetPasswordForm';
import { ChangePasswordCard } from '../ChangePasswordCard';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = 'email=layla@example.com';
});

const SURFACES = [
  {
    id: 'reset',
    Component: ResetPasswordForm,
    password: 'reset-password-password-input',
    confirm: 'reset-password-confirmPassword-input',
    form: 'reset-password-form',
  },
  {
    id: 'change',
    Component: ChangePasswordCard,
    password: 'new-password-input',
    confirm: 'confirm-password-input',
    form: 'change-password-form',
  },
] as const;

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('shared password policy in %s', (locale) => {
  describe.each(SURFACES)('$id', ({ id, Component, password: inputId, confirm, form: formId }) => {
    async function submit(password: string) {
      const bodies: unknown[] = [];
      stubNetwork(async (request) => {
        if (request.method === 'GET') return success(AUTH_METHODS);
        bodies.push(await request.json());
        return id === 'reset'
          ? refusalWith(400, ErrorCode.PASSWORD_RESET_CODE_INVALID)
          : success({});
      });
      const form = await renderForm(locale, <Component />);
      if (id === 'change') await screen.findByTestId('change-password-form');
      if (id === 'reset') change('reset-password-code-input', '000000');
      else change('current-password-input', 'old-password');
      change(inputId, password);
      change(confirm, password);
      await act(async () => {
        fireEvent.submit(screen.getByTestId(formId));
      });
      return { ...form, bodies };
    }

    it.each([
      ['', 'required'],
      ['Aa12345', 'min'],
      ['Aa1😀😀', 'min'],
      ['a1234567', 'uppercase'],
      ['A1234567', 'lowercase'],
      ['Abcdefgh', 'number'],
      ['Aa1' + 'é'.repeat(35), 'tooLong'],
    ])('refuses %s with the shared localized error and no write', async (password, key) => {
      const form = await submit(password);
      const input = screen.getByTestId(inputId);
      expect.soft(descriptions(input)).toEqual([form.message(`auth.passwordRules.errors.${key}`)]);
      expect.soft(form.bodies).toEqual([]);
    });

    it.each([
      ' Aa123456 ',
      'Aa123456',
      'Aa1' + 'é'.repeat(34),
      'Aa1' + 'é'.repeat(34) + 'x',
      'Aa1😀😀x',
    ])('submits a shared-valid password unchanged %s', async (password) => {
      const { bodies } = await submit(password);
      await waitFor(() =>
        expect(bodies).toEqual([
          id === 'reset'
            ? { email: 'layla@example.com', code: '000000', newPassword: password }
            : { currentPassword: 'old-password', newPassword: password },
        ]),
      );
    });
  });
});
