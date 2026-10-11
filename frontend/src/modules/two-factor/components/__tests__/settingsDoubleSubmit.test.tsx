// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
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
const RECOVERY = { recoveryCodes: ['K3M7QRTVWX', 'B8N2PLHZDF'] };

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
    await renderForm('en', <RegenerateCodesDialog open onOpenChange={vi.fn()} />);
    type('two-factor-regenerate-code', '123456');

    submitTwiceInOneTick(screen.getByTestId('two-factor-regenerate-form'));

    await screen.findByTestId('two-factor-recovery-codes');
    expect(requests).toEqual(['POST /api/auth/2fa/recovery-codes/regenerate']);
  });
});
