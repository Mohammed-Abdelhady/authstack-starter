// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import {
  makeStore,
  registerFormTestLifecycle,
  refusalWith,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { fieldNames } from '@/modules/auth/__tests__/fieldNames';
import { RegenerateCodesDialog } from '../RegenerateCodesDialog';
import { TwoFactorChallengePanel } from '../TwoFactorChallengePanel';
import { TwoFactorSetupDialog } from '../TwoFactorSetupDialog';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => navigation,
  Link: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('a', props, children),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SETUP = {
  secret: SECRET,
  otpauthUrl: `otpauth://totp/App:user@example.com?secret=${SECRET}&issuer=App`,
};
const RECOVERY = {
  recoveryCodes: [
    'K3M7QRTVWX',
    'B8N2PLHZDF',
    'M4N8QPVXCD',
    'W7J2KT9RHF',
    'A6C3D8VYPL',
    'Q5T2X9BMNR',
    'H8F4L2ZKPW',
    'R3Y7C5NQDM',
    'P9V6A4JXTK',
    'D2M8W5HCRL',
  ],
};
const METHODS = { methods: { password: true, magicLink: false, passkeys: false, oauth: [] } };

registerFormTestLifecycle();

/** Keeps the body of every write, keyed by `METHOD /path`. */
function recordWrites(answer: (path: string) => unknown) {
  const writes: Array<[string, unknown]> = [];
  stubNetwork(async (request, path) => {
    if (request.method === 'GET') return success(METHODS);
    writes.push([`${request.method} ${path}`, await request.json()]);
    return success(answer(path));
  });
  return writes;
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

// A field the form's schema does not name is dropped before the request is
// built. Each test lists the fields on screen and the body that must carry them.
describe('every field on a two-factor form reaches its request', () => {
  it('answers the sign-in challenge with the code', async () => {
    const writes = recordWrites(() => ({ requiresTwoFactor: false, user: USER }));
    await renderForm('en', <TwoFactorChallengePanel redirect={null} />);
    const form = screen.getByTestId('two-factor-form');
    expect(fieldNames(form)).toEqual(['code']);
    type('two-factor-code-input', '123456');

    fireEvent.submit(form);

    await waitFor(() =>
      expect(writes).toEqual([['POST /api/auth/2fa/verify', { code: '123456' }]]),
    );
  });

  it('accepts an authenticator code pasted with a separator', async () => {
    const writes = recordWrites(() => ({ requiresTwoFactor: false, user: USER }));
    await renderForm('en', <TwoFactorChallengePanel redirect={null} />);
    const code = screen.getByTestId('two-factor-code-input');
    expect(code).toHaveProperty('maxLength', -1);
    expect(code.hasAttribute('required')).toBe(true);
    type('two-factor-code-input', '123 456');

    fireEvent.submit(screen.getByTestId('two-factor-form'));

    await waitFor(() =>
      expect(writes).toEqual([['POST /api/auth/2fa/verify', { code: '123456' }]]),
    );
  });

  it('answers the sign-in challenge with a recovery code', async () => {
    const writes = recordWrites(() => ({ requiresTwoFactor: false, user: USER }));
    await renderForm('en', <TwoFactorChallengePanel redirect={null} />);
    const form = screen.getByTestId('two-factor-form');
    fireEvent.click(screen.getByTestId('two-factor-toggle-recovery'));
    expect(fieldNames(form)).toEqual(['recoveryCode']);
    expect(screen.getByTestId('two-factor-recovery-code-input').hasAttribute('required')).toBe(
      true,
    );
    type('two-factor-recovery-code-input', 'K3M7QRTVWX');

    fireEvent.submit(form);

    await waitFor(() =>
      expect(writes).toEqual([['POST /api/auth/2fa/verify', { recoveryCode: 'K3M7QRTVWX' }]]),
    );
  });

  it('shows the server lock countdown instead of losing retryAfter', async () => {
    stubNetwork((request) =>
      request.method === 'POST'
        ? refusalWith(429, ErrorCode.TWO_FACTOR_LOCKED, { retryAfter: 40 })
        : success(METHODS),
    );
    const form = await renderForm('en', <TwoFactorChallengePanel redirect={null} />);
    type('two-factor-code-input', '123456');
    fireEvent.submit(screen.getByTestId('two-factor-form'));

    await waitFor(() =>
      expect(screen.getByTestId('two-factor-error').textContent).toBe(
        form.format('auth.twoFactor.lockedCountdown', { seconds: 40 }),
      ),
    );
  });

  it('replaces the recovery codes with the code', async () => {
    const writes = recordWrites(() => RECOVERY);
    await renderForm('en', <RegenerateCodesDialog open onOpenChange={vi.fn()} hasPassword />);
    const form = screen.getByTestId('two-factor-regenerate-form');
    expect(fieldNames(form)).toEqual(['password', 'code']);
    expect(screen.getByTestId('two-factor-regenerate-password').hasAttribute('required')).toBe(
      true,
    );
    expect(screen.getByTestId('two-factor-regenerate-code').hasAttribute('required')).toBe(true);
    type('two-factor-regenerate-password', 'Passw0rdLayla');
    type('two-factor-regenerate-code', '123456');

    fireEvent.submit(form);

    await waitFor(() =>
      expect(writes).toEqual([
        [
          'POST /api/auth/2fa/recovery-codes/regenerate',
          { code: '123456', password: 'Passw0rdLayla' },
        ],
      ]),
    );
  });

  it('starts setup with the password and confirms it with the code', async () => {
    const writes = recordWrites((path) => (path === '/api/auth/2fa/setup' ? SETUP : RECOVERY));
    // Signed in, so the form also holds the hidden username a password manager reads.
    const store = makeStore();
    store.dispatch(loginFulfilled(USER));
    await renderForm('en', <TwoFactorSetupDialog open onOpenChange={vi.fn()} hasPassword />, store);
    const reauth = screen.getByTestId('two-factor-reauth-form');
    expect(screen.getByTestId('account-username')).toHaveProperty('form', reauth);
    expect(fieldNames(reauth)).toEqual(['password']);
    expect(screen.getByTestId('two-factor-reauth-password').hasAttribute('required')).toBe(true);
    type('two-factor-reauth-password', 'Passw0rdLayla');
    fireEvent.submit(reauth);
    fireEvent.click(await screen.findByTestId('two-factor-scan-continue'));
    const confirm = screen.getByTestId('two-factor-confirm-form');
    expect(fieldNames(confirm)).toEqual(['code']);
    type('two-factor-confirm-code', '123456');

    fireEvent.submit(confirm);

    await waitFor(() =>
      expect(writes).toEqual([
        ['POST /api/auth/2fa/setup', { password: 'Passw0rdLayla' }],
        ['POST /api/auth/2fa/confirm', { code: '123456' }],
      ]),
    );
  });
});
