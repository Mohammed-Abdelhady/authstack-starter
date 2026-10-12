// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import {
  clickTwiceInOneTick,
  submitTwiceInOneTick,
  writesOf,
} from '@/modules/auth/__tests__/submitTwice';
import { PasskeysCard } from '../PasskeysCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// The browser ceremony is the boundary: jsdom has no authenticator.
const browser = vi.hoisted(() => ({ startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  platformAuthenticatorIsAvailable: async () => true,
  startRegistration: browser.startRegistration,
}));

const PASSKEY = {
  id: 'pk-1',
  name: 'Laptop',
  deviceType: 'singleDevice',
  backedUp: false,
  createdAt: '2026-01-05T10:00:00.000Z',
  lastUsedAt: null,
};
const CREATED = { ...PASSKEY, id: 'pk-2', name: 'Mac' };

function server() {
  return stubNetwork((request, path) => {
    if (path === '/api/auth/passkeys/register/options') return success({ challenge: 'c-1' });
    if (path === '/api/auth/passkeys/register/verify') return success(CREATED);
    if (request.method === 'PATCH') return success({ ...PASSKEY, name: 'Work laptop' });
    if (request.method === 'DELETE') return success({ message: 'removed' });
    if (path === '/api/auth/passkeys') return success({ passkeys: [PASSKEY], canRemove: true });
    return success({ methods: { password: true, passkeys: true, oauth: [] } });
  });
}

registerFormTestLifecycle();

describe('passkey settings act once on two activations in one tick', () => {
  it('opens one browser prompt and stores one passkey', async () => {
    browser.startRegistration.mockResolvedValue({ id: 'credential-2' });
    const requests = server();
    const { message } = await renderForm('en', <PasskeysCard />);

    clickTwiceInOneTick(
      await screen.findByRole('button', { name: message('settings.passkeys.add') }),
    );

    await screen.findByTestId('passkey-name-dialog');
    expect(browser.startRegistration).toHaveBeenCalledTimes(1);
    expect(writesOf(requests)).toEqual([
      'POST /api/auth/passkeys/register/options',
      'POST /api/auth/passkeys/register/verify',
    ]);
  });

  it('renames a passkey once', async () => {
    const requests = server();
    await renderForm('en', <PasskeysCard />);
    fireEvent.click(await screen.findByTestId('passkey-rename-pk-1'));
    fireEvent.change(await screen.findByTestId('passkey-name-input'), {
      target: { value: 'Work laptop' },
    });

    submitTwiceInOneTick(screen.getByTestId('passkey-name-form'));

    await waitFor(() => expect(screen.queryByTestId('passkey-name-dialog')).toBeNull());
    expect(writesOf(requests)).toEqual(['PATCH /api/auth/passkeys/pk-1']);
  });

  it('removes a passkey once', async () => {
    const requests = server();
    const { successToasts, message } = await renderForm('en', <PasskeysCard />);
    fireEvent.click(await screen.findByTestId('passkey-delete-pk-1'));

    clickTwiceInOneTick(await screen.findByTestId('passkey-delete-confirm'));

    await waitFor(() =>
      expect(successToasts()).toEqual([message('settings.passkeys.delete.success')]),
    );
    expect(writesOf(requests)).toEqual(['DELETE /api/auth/passkeys/pk-1']);
  });
});
