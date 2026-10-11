// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { clickTwiceInOneTick } from '@/modules/auth/__tests__/submitTwice';
import { PasskeySignInButton } from '../PasskeySignInButton';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => navigation }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// The browser ceremony is the boundary: jsdom has no authenticator.
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: browser.startAuthentication,
}));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};

registerFormTestLifecycle();

describe('passkey sign-in', () => {
  it('starts one ceremony when the button is activated twice in one tick', async () => {
    browser.startAuthentication.mockResolvedValue({ id: 'credential-1' });
    const requests = stubNetwork((_request, path) =>
      path === '/api/auth/passkeys/login/options'
        ? success({ challenge: 'challenge-1' })
        : success({ requiresTwoFactor: false, user: USER }),
    );
    const { message } = await renderForm(
      'en',
      <PasskeySignInButton redirect={null} isOnlyMethod />,
    );

    clickTwiceInOneTick(
      await screen.findByRole('button', { name: message('auth.passkeys.signIn') }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
    expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([
      'POST /api/auth/passkeys/login/options',
      'POST /api/auth/passkeys/login/verify',
    ]);
  });
});
