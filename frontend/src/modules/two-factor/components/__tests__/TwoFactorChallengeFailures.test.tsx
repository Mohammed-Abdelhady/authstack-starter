// @vitest-environment jsdom
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import { unreachable } from '@/tests/busyControls';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { TWO_FACTOR_PATHS } from '../../constants';
import { TwoFactorChallengePanel } from '../TwoFactorChallengePanel';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => navigation,
  Link: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('a', props, children),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const METHODS = {
  methods: { password: true, magicLink: false, twoFactor: true, passkeys: false, oauth: [] },
};
const REFUSALS = [
  [ErrorCode.TWO_FACTOR_CODE_INVALID, 'errors.codes.TWO_FACTOR_CODE_INVALID'],
  [ErrorCode.TWO_FACTOR_CHALLENGE_INVALID, 'errors.codes.TWO_FACTOR_CHALLENGE_INVALID'],
] as const;

registerFormTestLifecycle();
beforeEach(() => {
  navigation.push.mockClear();
  navigation.replace.mockClear();
});

function submitCode() {
  fireEvent.change(screen.getByTestId('two-factor-code-input'), {
    target: { value: '123456' },
  });
  fireEvent.submit(screen.getByTestId('two-factor-form'));
}

describe.each(['en', 'ar'] as const)('two-factor challenge failures in %s', (locale) => {
  it.each(REFUSALS)('shows the localized error for %s without signing in', async (code, key) => {
    stubNetwork((_request, path) =>
      path === '/api/auth/methods' ? success(METHODS) : refusalWith(401, code),
    );
    const form = await renderForm(locale, <TwoFactorChallengePanel redirect={null} />);

    submitCode();

    const alert = await screen.findByTestId('two-factor-error');
    expect(alert.textContent).toBe(form.message(key));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it('shows the localized network refusal and stays signed out', async () => {
    stubNetwork((_request, path) =>
      path === '/api/auth/methods' ? success(METHODS) : unreachable(),
    );
    const form = await renderForm(locale, <TwoFactorChallengePanel redirect={null} />);

    submitCode();

    const alert = await screen.findByTestId('two-factor-error');
    expect(alert.textContent).toBe(form.message('errors.codes.INTERNAL_ERROR'));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('honors the lock duration and blocks another code request', async () => {
    const requests = stubNetwork((_request, path) =>
      path === '/api/auth/methods'
        ? success(METHODS)
        : refusalWith(429, ErrorCode.TWO_FACTOR_LOCKED, { retryAfter: 30 }),
    );
    const form = await renderForm(locale, <TwoFactorChallengePanel redirect={null} />);

    submitCode();

    const alert = await screen.findByTestId('two-factor-error');
    expect(alert.textContent).toBe(form.format('auth.twoFactor.lockedCountdown', { seconds: 30 }));
    expect(screen.getByTestId('two-factor-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.submit(screen.getByTestId('two-factor-form'));
    expect(
      requests.filter((request) => request === `POST ${TWO_FACTOR_PATHS.VERIFY}`),
    ).toHaveLength(1);
  });

  it('shows a localized lock refusal when the server omits a usable duration', async () => {
    stubNetwork((_request, path) =>
      path === '/api/auth/methods'
        ? success(METHODS)
        : refusalWith(429, ErrorCode.TWO_FACTOR_LOCKED, { retryAfter: '30' }),
    );
    const form = await renderForm(locale, <TwoFactorChallengePanel redirect={null} />);

    submitCode();

    const alert = await screen.findByTestId('two-factor-error');
    expect(alert.textContent).toBe(form.message('auth.twoFactor.locked'));
    expect(alert.textContent).not.toContain('30');
    expect(screen.getByTestId('two-factor-submit').hasAttribute('disabled')).toBe(false);
  });

  it('refreshes auth methods after a disabled response without adding a form error', async () => {
    let methodReads = 0;
    const requests = stubNetwork((_request, path) => {
      if (path === '/api/auth/methods') {
        methodReads += 1;
        return success(METHODS);
      }
      if (path === TWO_FACTOR_PATHS.VERIFY) {
        return refusalWith(503, ErrorCode.FEATURE_DISABLED);
      }
      return success({});
    });
    await renderForm(locale, <TwoFactorChallengePanel redirect={null} />);
    submitCode();

    await vi.waitFor(() => expect(methodReads).toBe(2));
    expect(requests).toContain('POST /api/auth/2fa/verify');
    expect(screen.queryByTestId('two-factor-error')).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
