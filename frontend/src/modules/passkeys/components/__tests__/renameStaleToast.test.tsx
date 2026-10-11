// @vitest-environment jsdom
import { isHeld } from '@/tests/busyControls';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { refuseFirstWrite, sendRefusedThenAgain, toastOrder } from '@/tests/staleToast';
import { PasskeysCard } from '../PasskeysCard';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
// The browser ceremony is the boundary: jsdom has no authenticator.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  platformAuthenticatorIsAvailable: async () => true,
  startRegistration: vi.fn(),
}));

const PASSKEY = {
  id: 'pk-1',
  name: 'Laptop',
  deviceType: 'singleDevice',
  backedUp: false,
  createdAt: '2026-01-05T10:00:00.000Z',
  lastUsedAt: null,
};

registerFormTestLifecycle();

describe('the toast of a refused passkey rename', () => {
  it('is gone when the name is sent again and accepted', async () => {
    refuseFirstWrite({ ...PASSKEY, name: 'Work laptop' }, (path) =>
      path === '/api/auth/passkeys'
        ? { passkeys: [PASSKEY], canRemove: true }
        : { methods: { password: true, passkeys: true, oauth: [] } },
    );
    await renderForm('en', <PasskeysCard />);
    fireEvent.click(await screen.findByTestId('passkey-rename-pk-1'));
    const form = await screen.findByTestId('passkey-name-form');
    const name = screen.getByTestId('passkey-name-input');
    fireEvent.change(name, { target: { value: 'Work laptop' } });

    await sendRefusedThenAgain(
      () => fireEvent.submit(form),
      () => !isHeld(name),
    );

    await waitFor(() => expect(screen.queryByTestId('passkey-name-dialog')).toBeNull());
    expect(toastOrder()).toEqual(['error', 'dismiss']);
  });
});
