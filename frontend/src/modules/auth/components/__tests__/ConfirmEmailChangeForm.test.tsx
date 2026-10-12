// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import {
  descriptions,
  refusal,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { submitTwiceInOneTick } from '../../__tests__/submitTwice';
import { ConfirmEmailChangeForm } from '../ConfirmEmailChangeForm';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('a', props, children),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
registerFormTestLifecycle();

async function submit(locale: AppLocale, code = '123456') {
  const form = await renderForm(locale, <ConfirmEmailChangeForm />);
  const codeField = screen.getByRole('textbox', { name: form.message('auth.activate.code') });
  const codeMaxLength = codeField.getAttribute('maxlength');
  fireEvent.change(screen.getByRole('textbox', { name: form.message('auth.activate.email') }), {
    target: { value: 'new@example.com' },
  });
  fireEvent.change(codeField, { target: { value: code } });
  fireEvent.submit(screen.getByTestId('confirm-email-form'));
  return { ...form, codeMaxLength };
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('email change confirmation in %s', (locale) => {
  it('sends only email and code, shows success and offers sign-in without a session read', async () => {
    const bodies: unknown[] = [];
    const requests = stubNetwork(async (request) => {
      bodies.push(await request.json());
      return success({ message: 'Confirmed' });
    });
    const form = await submit(locale, '123 456');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        form.message('auth.confirmEmailChange.success'),
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: form.message('auth.confirmEmailChange.successTitle') }),
      ),
    );
    expect(bodies).toEqual([{ email: 'new@example.com', code: '123456' }]);
    expect(form.codeMaxLength).toBeNull();
    expect(requests).toEqual(['POST /api/auth/confirm-email-change']);
    expect(
      screen
        .getByRole('link', { name: form.message('auth.confirmEmailChange.signIn') })
        .getAttribute('href'),
    ).toBe('/auth/login');
  });

  it('confirms once when the form is submitted twice in one tick', async () => {
    const requests = stubNetwork(() => success({ message: 'Confirmed' }));
    const form = await renderForm(locale, <ConfirmEmailChangeForm />);
    fireEvent.change(screen.getByRole('textbox', { name: form.message('auth.activate.email') }), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: form.message('auth.activate.code') }), {
      target: { value: '123456' },
    });

    submitTwiceInOneTick(screen.getByTestId('confirm-email-form'));

    await screen.findByTestId('confirm-email-success');
    expect(requests).toEqual(['POST /api/auth/confirm-email-change']);
  });

  it('shows a rejected code through the catalogue and keeps both fields', async () => {
    stubNetwork(() => refusalWith(400, ErrorCode.ACTIVATION_CODE_INVALID));
    const form = await submit(locale);
    await waitFor(() =>
      expect(screen.getByTestId('confirm-email-error').textContent).toBe(
        form.message('errors.codes.ACTIVATION_CODE_INVALID'),
      ),
    );
    expect(screen.getByTestId('confirm-email-input')).toHaveProperty('value', 'new@example.com');
    expect(screen.getByTestId('confirm-email-code-input')).toHaveProperty('value', '123456');
    expect(screen.queryByTestId('confirm-email-success')).toBeNull();
  });

  it('marks server fields and focuses the first without losing values', async () => {
    stubNetwork(() => refusal(['email', 'code']));
    const form = await submit(locale);
    for (const testId of ['confirm-email-input', 'confirm-email-code-input']) {
      const field = screen.getByTestId(testId);
      await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
      expect(descriptions(field)).toEqual([form.fieldMessage]);
    }
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('confirm-email-input')),
    );
    expect(screen.getByTestId('confirm-email-input')).toHaveProperty('value', 'new@example.com');
    expect(screen.getByTestId('confirm-email-code-input')).toHaveProperty('value', '123456');
  });
});
