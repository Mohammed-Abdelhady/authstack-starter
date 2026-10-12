// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import { ResetPasswordForm } from '../ResetPasswordForm';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => navigation,
  Link: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('a', props, children),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const RETURN_QUERY = 'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-recovery';
const LOGIN = `/auth/login?${RETURN_QUERY}`;
const FORGOT = `/auth/forgot-password?${RETURN_QUERY}`;
registerFormTestLifecycle();

beforeEach(() => {
  navigation.push.mockClear();
  navigation.search = RETURN_QUERY;
});
afterEach(() => vi.useRealTimers());

function fillReset() {
  for (const [id, value] of [
    ['reset-password-code-input', '123456'],
    ['reset-password-password-input', 'NewPassw0rdLayla'],
    ['reset-password-confirmPassword-input', 'NewPassw0rdLayla'],
  ])
    fireEvent.change(screen.getByTestId(id), { target: { value } });
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('native recovery continuation in %s', (locale) => {
  it('passes the request form output into reset and then fresh sign-in', async () => {
    stubNetwork(() => success({ message: 'accepted' }));
    const forgot = await renderForm(locale, <ForgotPasswordForm />);
    fireEvent.change(screen.getByTestId('forgot-password-email-input'), {
      target: { value: 'layla@example.com' },
    });
    fireEvent.submit(screen.getByTestId('forgot-password-form'));

    const resetPath =
      '/auth/reset-password?email=layla%40example.com&redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-recovery';
    await waitFor(() => expect(navigation.push).toHaveBeenCalledExactlyOnceWith(resetPath));
    const actualTarget: unknown = navigation.push.mock.calls[0]?.[0];
    if (typeof actualTarget !== 'string') throw new Error('No reset navigation');
    navigation.search = actualTarget.slice(actualTarget.indexOf('?') + 1);
    forgot.unmount();
    navigation.push.mockClear();
    const reset = await renderForm(locale, <ResetPasswordForm />);
    fillReset();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('reset-password-form'));
      for (let turn = 0; turn < 12; turn++) await Promise.resolve();
    });
    expect(reset.successToasts()).toContain(reset.message('toast.success.passwordReset'));
    await act(async () => vi.advanceTimersByTime(1500));
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(LOGIN);
  });

  it('retains the continuation when reset lacks an email', async () => {
    stubNetwork(() => success({}));
    await renderForm(locale, <ResetPasswordForm />);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledExactlyOnceWith(FORGOT));
  });

  it('retains the continuation when requesting another code or using the login link', async () => {
    navigation.search = `email=layla%40example.com&${RETURN_QUERY}`;
    stubNetwork((request) =>
      request.method === 'POST'
        ? refusalWith(400, ErrorCode.PASSWORD_RESET_CODE_INVALID)
        : success({}),
    );
    await renderForm(locale, <ResetPasswordForm />);
    fillReset();
    fireEvent.submit(screen.getByTestId('reset-password-form'));
    const requestNew = await screen.findByTestId('request-new-code-link');
    expect(requestNew.getAttribute('href')).toBe(FORGOT);
    expect(screen.getByTestId('back-to-login-link').getAttribute('href')).toBe(LOGIN);
  });
});
