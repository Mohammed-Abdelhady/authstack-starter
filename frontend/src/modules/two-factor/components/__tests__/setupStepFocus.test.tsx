// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { TwoFactorSetupDialog } from '../TwoFactorSetupDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const SECRET = 'JBSWY3DPEHPK3PXP';
const SETUP = {
  secret: SECRET,
  otpauthUrl: `otpauth://totp/App:user@example.com?secret=${SECRET}&issuer=App`,
};
const RECOVERY = { recoveryCodes: ['K3M7QRTVWX', 'B8N2PLHZDF'] };

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus through the steps of two-step setup in %s', (locale) => {
  it('goes to the title when a step has no field of its own, and to the field when it has', async () => {
    stubNetwork((_request, path) =>
      path === '/api/auth/2fa/setup' ? success(SETUP) : success(RECOVERY),
    );
    const { message } = await renderForm(
      locale,
      <TwoFactorSetupDialog open onOpenChange={vi.fn()} hasPassword />,
    );
    const title = screen.getByRole('heading', {
      name: message('settings.twoFactor.setup.title'),
    });
    const step = (name: string) => message(`settings.twoFactor.setup.${name}.description`);
    const password = screen.getByTestId('two-factor-reauth-password');
    fireEvent.change(password, { target: { value: 'Passw0rdLayla' } });
    password.focus();

    fireEvent.submit(screen.getByTestId('two-factor-reauth-form'));

    // The password step is gone, and the code to scan has no field to land on.
    const toConfirm = await screen.findByTestId('two-factor-scan-continue');
    await waitFor(() => expect(document.activeElement).toBe(title));
    const described = screen.getByText(step('scan'));
    expect(described.getAttribute('aria-live')).toBe('polite');

    toConfirm.focus();
    fireEvent.click(toConfirm);

    // The step that asks for a code puts the focus in its field itself.
    const code = await screen.findByTestId('two-factor-confirm-code');
    await waitFor(() => expect(document.activeElement).toBe(code));

    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(screen.getByTestId('two-factor-confirm-form'));

    await screen.findByTestId('two-factor-recovery-codes');
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.getByText(step('recoveryCodes'))).toBeTruthy();
  });
});
