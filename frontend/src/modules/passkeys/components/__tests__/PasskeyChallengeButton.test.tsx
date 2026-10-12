// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { PASSKEY_PATHS } from '../../constants';
import { PasskeyChallengeButton } from '../PasskeyChallengeButton';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: browser.startAuthentication,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};
const METHODS = {
  methods: { password: true, magicLink: false, twoFactor: true, passkeys: true, oauth: [] },
};
const AUTHENTICATION = {
  id: 'credential-1',
  rawId: 'credential-1',
  type: 'public-key',
  response: {
    authenticatorData: 'auth-data',
    clientDataJSON: 'client-data',
    signature: 'signature',
    userHandle: null,
  },
  clientExtensionResults: {},
};

registerFormTestLifecycle();

describe('passkey second step', () => {
  it('sends the browser response as passkeyResponse and completes sign-in after verification', async () => {
    browser.startAuthentication.mockResolvedValue(AUTHENTICATION);
    let verificationBody: unknown;
    const requests = stubNetwork(async (request, path) => {
      if (path === '/api/auth/methods') return success(METHODS);
      if (path === PASSKEY_PATHS.LOGIN_OPTIONS) {
        return success({ challenge: 'challenge-1', allowCredentials: [] });
      }
      if (path === PASSKEY_PATHS.TWO_FACTOR_VERIFY) {
        verificationBody = await request.json();
        return success({ requiresTwoFactor: false, user: USER });
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    const { message } = await renderForm('en', <PasskeyChallengeButton redirect={null} />);
    const button = await screen.findByRole('button', {
      name: message('auth.passkeys.useInstead'),
    });

    fireEvent.click(button);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
    expect(verificationBody).toEqual({ passkeyResponse: AUTHENTICATION });
    expect(browser.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'challenge-1', allowCredentials: [] },
    });
    expect(requests).toEqual([
      'GET /api/auth/methods',
      `POST ${PASSKEY_PATHS.LOGIN_OPTIONS}`,
      `POST ${PASSKEY_PATHS.TWO_FACTOR_VERIFY}`,
    ]);
  });
});
