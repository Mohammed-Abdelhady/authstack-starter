// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import {
  registerFormTestLifecycle,
  renderForm,
  refusalWith,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { submitTwiceInOneTick } from '@/modules/auth/__tests__/submitTwice';
import { RegenerateCodesDialog } from '../RegenerateCodesDialog';
import { TwoFactorDisableDialog } from '../TwoFactorDisableDialog';
import { TwoFactorSetupDialog } from '../TwoFactorSetupDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

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

registerFormTestLifecycle();

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

describe('two-factor settings send one request for two submissions in one tick', () => {
  it('starts setup once and confirms it once', async () => {
    const requests = stubNetwork((_request, path) =>
      path === '/api/auth/2fa/setup' ? success(SETUP) : success(RECOVERY),
    );
    await renderForm('en', <TwoFactorSetupDialog open onOpenChange={vi.fn()} hasPassword />);
    type('two-factor-reauth-password', 'Passw0rdLayla');

    submitTwiceInOneTick(screen.getByTestId('two-factor-reauth-form'));

    fireEvent.click(await screen.findByTestId('two-factor-scan-continue'));
    expect(requests).toEqual(['POST /api/auth/2fa/setup']);

    type('two-factor-confirm-code', '123456');
    submitTwiceInOneTick(screen.getByTestId('two-factor-confirm-form'));

    await screen.findByTestId('two-factor-recovery-codes');
    expect(requests).toEqual(['POST /api/auth/2fa/setup', 'POST /api/auth/2fa/confirm']);
    expect(screen.queryByTestId('two-factor-setup-error')).toBeNull();
  });

  it('turns the second factor off once', async () => {
    const requests = stubNetwork(() => success({ message: 'off' }));
    const onOpenChange = vi.fn();
    const { successToasts, message } = await renderForm(
      'en',
      <TwoFactorDisableDialog open onOpenChange={onOpenChange} hasPassword={false} />,
    );
    type('two-factor-code-input', '123456');

    submitTwiceInOneTick(screen.getByTestId('two-factor-disable-form'));

    await vi.waitFor(() => expect(onOpenChange.mock.calls).toEqual([[false]]));
    expect(requests).toEqual(['POST /api/auth/2fa/disable']);
    expect(successToasts()).toEqual([message('settings.twoFactor.disable.success')]);
  });

  it('issues one new batch of recovery codes', async () => {
    const requests = stubNetwork(() => success(RECOVERY));
    const form = await renderForm('en', <RegenerateCodesDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: form.message('common.close') })).toBeTruthy();
    type('two-factor-regenerate-code', '123456');

    submitTwiceInOneTick(screen.getByTestId('two-factor-regenerate-form'));

    await screen.findByTestId('two-factor-recovery-codes');
    expect(requests).toEqual(['POST /api/auth/2fa/recovery-codes/regenerate']);
    expect(screen.queryByRole('button', { name: form.message('common.close') })).toBeNull();
  });

  it('honors the server lock and blocks another recovery-code request', async () => {
    const requests = stubNetwork((_request, path) =>
      path === '/api/auth/2fa/recovery-codes/regenerate'
        ? refusalWith(429, ErrorCode.TWO_FACTOR_LOCKED, { retryAfter: 45 })
        : success({}),
    );
    const form = await renderForm('en', <RegenerateCodesDialog open onOpenChange={vi.fn()} />);
    type('two-factor-regenerate-code', '123456');

    fireEvent.submit(screen.getByTestId('two-factor-regenerate-form'));

    const alert = await screen.findByTestId('two-factor-regenerate-error');
    expect(alert.textContent).toBe(
      form.format('settings.twoFactor.regenerate.lockedCountdown', { seconds: 45 }),
    );
    expect(screen.getByTestId('two-factor-regenerate-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.submit(screen.getByTestId('two-factor-regenerate-form'));
    expect(requests).toEqual(['POST /api/auth/2fa/recovery-codes/regenerate']);
  });

  it('shows a localized lock refusal when the server omits a usable duration', async () => {
    stubNetwork((_request, path) =>
      path === '/api/auth/2fa/recovery-codes/regenerate'
        ? refusalWith(429, ErrorCode.TWO_FACTOR_LOCKED, { retryAfter: '45' })
        : success({}),
    );
    const form = await renderForm('en', <RegenerateCodesDialog open onOpenChange={vi.fn()} />);
    type('two-factor-regenerate-code', '123456');
    fireEvent.submit(screen.getByTestId('two-factor-regenerate-form'));

    const alert = await screen.findByTestId('two-factor-regenerate-error');
    expect(alert.textContent).toBe(form.message('settings.twoFactor.regenerate.locked'));
    expect(alert.textContent).not.toContain('45');
    expect(screen.getByTestId('two-factor-regenerate-submit').hasAttribute('disabled')).toBe(false);
  });
});
