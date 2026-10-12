// @vitest-environment jsdom
import { AUTH_METHODS, navigation } from './registrationHarness';
import { describe, expect, it } from 'vitest';
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
import { RegisterForm } from '../RegisterForm';

import { beforeEach } from 'vitest';

beforeEach(() => {
  navigation.search = '';
});

async function submitRegistration(locale: AppLocale) {
  const form = await renderForm(locale, <RegisterForm />);
  const email = screen.getByRole('textbox', { name: form.message('auth.register.email') });

  fireEvent.change(email, { target: { value: 'layla@example.com' } });
  fireEvent.submit(screen.getByTestId('register-form'));

  return { ...form, email };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('RegisterForm refused by the server in %s', (locale) => {
  it('marks and focuses the rejected field and shows the localized general message once', async () => {
    const requests = refuseWrites(['email', 'nickname'], AUTH_METHODS);

    const { email, fieldMessage, generalMessage, errorToasts } = await submitRegistration(locale);

    await waitFor(() => {
      expect(email.getAttribute('aria-invalid')).toBe('true');
    });
    expect(descriptions(email)).toEqual([fieldMessage]);
    expect(screen.getByTestId('register-email-input')).toHaveProperty('value', 'layla@example.com');
    // The field takes the focus once the form is enabled again.
    await waitFor(() => {
      expect(document.activeElement).toBe(email);
    });
    expect(screen.getByRole('alert').textContent).toBe(generalMessage);
    expect(errorToasts()).toEqual([generalMessage]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(document.body.textContent).not.toContain('Validation failed');
    expect(requests.allRequests.filter((request) => request.startsWith('GET /api/auth/'))).toEqual([
      'GET /api/auth/methods',
      'GET /api/auth/csrf',
      'GET /api/auth/browser-proof',
    ]);
    expect(requests).toContain('POST /api/auth/register');
  });

  it('shows only the general message when the server names no field of the form', async () => {
    refuseWrites(['nickname'], AUTH_METHODS);

    const { email, generalMessage } = await submitRegistration(locale);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(generalMessage);
    expect(screen.getByTestId('register-email-input')).toHaveProperty('value', 'layla@example.com');
    expect(email.getAttribute('aria-invalid')).toBe('false');
  });

  it.each([
    ['refuses', () => refusalWith(429, ErrorCode.RATE_LIMIT_EXCEEDED)],
    [
      'cannot reach',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ] as const)('sends no registration when browser proof %s', async (_state, proofAnswer) => {
    const requests = stubNetwork(
      (_request, path) => {
        if (path === '/api/auth/methods') return success(AUTH_METHODS);
        if (path === '/api/auth/csrf') return refusalWith(401, ErrorCode.SESSION_REQUIRED);
        if (path === '/api/auth/browser-proof') return proofAnswer();
        throw new Error(`Unexpected path: ${path}`);
      },
      { proof: 'delegate' },
    );

    await submitRegistration(locale);
    await waitFor(() => expect(requests.allRequests).toContain('GET /api/auth/browser-proof'));
    await screen.findByRole('alert');
    expect(requests.allRequests).toEqual([
      'GET /api/auth/methods',
      'GET /api/auth/csrf',
      'GET /api/auth/browser-proof',
    ]);
  });
});
