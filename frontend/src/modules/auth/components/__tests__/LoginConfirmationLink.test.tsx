// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import {
  refusalWith,
  renderForm,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { heldAnswer } from '@/tests/busyControls';
import { LoginForm } from '../LoginForm';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('a', props, children),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('new-address confirmation entry in %s', (locale) => {
  it('stays available while method discovery is pending', async () => {
    const held = heldAnswer();
    const requests = stubNetwork((_, path) =>
      path === '/api/auth/methods' ? held.answer : success({ providers: [] }),
    );
    const form = await renderForm(locale, <LoginForm />);
    const link = screen.getByRole('link', { name: form.message('auth.login.confirmNewEmail') });
    expect(link.getAttribute('href')).toBe('/auth/confirm-email-change');
    expect(screen.getByTestId('auth-methods-loading')).toBeDefined();
    expect(requests).toEqual(['GET /api/auth/methods']);
    await act(async () =>
      held.settle(() =>
        success({ methods: { password: false, magicLink: false, passkeys: false, oauth: [] } }),
      ),
    );
    expect(screen.getByTestId('auth-methods-empty')).toBeDefined();
    expect(screen.getByRole('link', { name: form.message('auth.login.confirmNewEmail') })).toBe(
      link,
    );
  });

  it('stays available after method discovery fails', async () => {
    stubNetwork((_, path) =>
      path === '/api/auth/methods'
        ? refusalWith(503, ErrorCode.AUTHORITY_UNAVAILABLE)
        : success({ providers: [] }),
    );
    const form = await renderForm(locale, <LoginForm />);
    await screen.findByRole('alert');
    expect(
      screen
        .getByRole('link', { name: form.message('auth.login.confirmNewEmail') })
        .getAttribute('href'),
    ).toBe('/auth/confirm-email-change');
  });
});
