// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { ErrorCode } from '@app/core';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import {
  descriptions,
  identitySuccess,
  makeStore,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { PASSKEY_PATHS, passkeyPath } from '../../constants';
import { PasskeysCard } from '../PasskeysCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  platformAuthenticatorIsAvailable: async () => true,
  startRegistration: async () => ({
    id: 'credential',
    rawId: 'credential',
    type: 'public-key',
    response: { clientDataJSON: 'client', attestationObject: 'attestation' },
    clientExtensionResults: {},
  }),
}));

const PASSKEY = {
  id: 'pk-1',
  name: 'Laptop',
  deviceType: 'singleDevice',
  backedUp: false,
  createdAt: '2026-01-05T10:00:00.000Z',
  lastUsedAt: null,
};
const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};
const IDENTITY_USER = {
  locale: 'en',
  ...USER,
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false, // feature:totp
  passkeyCount: 0, // feature:passkeys
  linkedProviders: ['email'],
};
const REMOVE = `DELETE ${passkeyPath(PASSKEY.id)}`;
const IDENTITY_PATH = '/api/auth/identity';

/** A server with passkeys on and one passkey listed, answering as scripted. */
function server(script: { canRemove?: boolean; remove?: () => Response }) {
  return stubNetwork((request, path) => {
    if (request.method === 'DELETE') {
      return script.remove?.() ?? success({ message: 'removed' });
    }
    if (path === PASSKEY_PATHS.LIST) {
      return success({ passkeys: [PASSKEY], canRemove: script.canRemove });
    }
    return success({ methods: { password: true, passkeys: true, oauth: [] } });
  });
}

async function renderCard(locale: AppLocale) {
  const view = await renderForm(locale, <PasskeysCard />);
  const remove = await screen.findByRole('button', {
    name: view.format('settings.passkeys.delete.label', { name: PASSKEY.name }),
  });
  return { ...view, remove };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('PasskeysCard in %s', (locale) => {
  it.each([{ canRemove: true }, { canRemove: undefined }])(
    'offers the removal when the server says $canRemove',
    async ({ canRemove }) => {
      const requests = server({ canRemove });

      const { remove } = await renderCard(locale);

      expect(remove.getAttribute('aria-disabled')).toBeNull();
      expect(descriptions(remove)).toEqual([]);
      fireEvent.click(remove);
      fireEvent.click(await screen.findByTestId('passkey-delete-confirm'));
      await waitFor(() => expect(requests).toContain(REMOVE));
    },
  );

  it('keeps a refused removal in reach and says why, without sending it', async () => {
    const requests = server({ canRemove: false });

    const { remove, message } = await renderCard(locale);

    // Not the native attribute: a disabled button leaves the tab order.
    expect(remove.hasAttribute('disabled')).toBe(false);
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(descriptions(remove)).toEqual([
      message('settings.passkeys.delete.blockedLastSignInMethod'),
    ]);

    fireEvent.click(remove);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(requests.filter((request) => request.startsWith('DELETE'))).toEqual([]);
  });

  it('shows the refusal in the dialog when the server refuses a removal it had allowed', async () => {
    const requests = server({
      canRemove: true,
      remove: () => refusalWith(409, 'PASSKEY_LAST_SIGN_IN_METHOD'),
    });

    const { remove, message, successToasts } = await renderCard(locale);
    fireEvent.click(remove);
    fireEvent.click(await screen.findByTestId('passkey-delete-confirm'));

    const refusal = await screen.findByTestId('passkey-delete-error');
    expect(refusal.textContent).toBe(message('errors.codes.PASSKEY_LAST_SIGN_IN_METHOD'));
    expect(requests).toContain(REMOVE);
    expect(successToasts()).toEqual([]);
    expect(screen.getByTestId(`passkey-row-${PASSKEY.id}`)).toBeTruthy();
  });

  it('offers the existing sign-out path when a fresh sign-in is required', async () => {
    const requests = stubNetwork((_request, path) => {
      if (path === IDENTITY_PATH) return identitySuccess(IDENTITY_USER);
      if (path === PASSKEY_PATHS.REGISTER_OPTIONS) {
        return refusalWith(401, ErrorCode.REAUTH_REQUIRED, { required: 'recent_sign_in' });
      }
      if (path === PASSKEY_PATHS.LIST) return success({ passkeys: [], canRemove: true });
      return success({ methods: { password: true, passkeys: true, oauth: [] } });
    });
    const store = makeStore();
    store.dispatch(loginFulfilled(USER));
    const view = await renderForm(locale, <PasskeysCard />, store);

    fireEvent.click(await screen.findByTestId('passkey-add'));

    const message = await screen.findByTestId('passkey-registration-recent-sign-in');
    expect(message.textContent).toContain(
      view.message('settings.passkeys.registration.recentSignInRequired'),
    );
    expect(screen.getByRole('button', { name: view.message('auth.activate.logout') })).toBeTruthy();
    expect(
      requests.filter((request) => request.includes(PASSKEY_PATHS.REGISTER_OPTIONS)),
    ).toHaveLength(1);
  });

  // feature:totp:start
  it('uses the server lock duration and blocks another registration request', async () => {
    let optionRequests = 0;
    const requests = stubNetwork((_request, path) => {
      if (path === PASSKEY_PATHS.LIST) return success({ passkeys: [], canRemove: true });
      if (path === PASSKEY_PATHS.REGISTER_OPTIONS) {
        optionRequests += 1;
        return optionRequests === 1
          ? refusalWith(401, ErrorCode.REAUTH_REQUIRED, { required: 'second_factor' })
          : refusalWith(429, ErrorCode.TWO_FACTOR_LOCKED, { retryAfter: 60 });
      }
      return success({ methods: { password: true, passkeys: true, oauth: [] } });
    });
    const view = await renderForm(locale, <PasskeysCard />);

    fireEvent.click(await screen.findByTestId('passkey-add'));
    fireEvent.change(await screen.findByTestId('passkey-registration-factor'), {
      target: { value: '123456' },
    });
    fireEvent.submit(screen.getByTestId('passkey-registration-proof-form'));

    const error = await screen.findByTestId('passkey-add-error');
    expect(error.textContent).toBe(
      view.format('settings.passkeys.registration.lockedCountdown', { seconds: 60 }),
    );
    expect(screen.getByTestId('passkey-proof-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.submit(screen.getByTestId('passkey-registration-proof-form'));
    expect(optionRequests).toBe(2);
    expect(
      requests.filter((request) => request.includes(PASSKEY_PATHS.REGISTER_OPTIONS)),
    ).toHaveLength(2);
  });

  it('shows a localized lock refusal without inventing a countdown', async () => {
    let optionRequests = 0;
    const requests = stubNetwork((_request, path) => {
      if (path === PASSKEY_PATHS.LIST) return success({ passkeys: [], canRemove: true });
      if (path === PASSKEY_PATHS.REGISTER_OPTIONS) {
        optionRequests += 1;
        return optionRequests === 1
          ? refusalWith(401, ErrorCode.REAUTH_REQUIRED, { required: 'second_factor' })
          : refusalWith(429, ErrorCode.TWO_FACTOR_LOCKED, { retryAfter: '60' });
      }
      return success({ methods: { password: true, passkeys: true, oauth: [] } });
    });
    const view = await renderForm('en', <PasskeysCard />);

    fireEvent.click(await screen.findByTestId('passkey-add'));
    fireEvent.change(await screen.findByTestId('passkey-registration-factor'), {
      target: { value: '123456' },
    });
    fireEvent.submit(screen.getByTestId('passkey-registration-proof-form'));

    const error = await screen.findByTestId('passkey-add-error');
    expect(error.textContent).toBe(view.message('settings.passkeys.registration.locked'));
    expect(error.textContent).not.toContain('60');
    expect(screen.getByTestId('passkey-proof-submit').hasAttribute('disabled')).toBe(false);
    expect(
      requests.filter((request) => request.includes(PASSKEY_PATHS.REGISTER_OPTIONS)),
    ).toHaveLength(2);
  });
  // feature:totp:end

  it('sends each requested fresh proof and verifies the exact browser response', async () => {
    const writes: Array<[string, unknown]> = [];
    let registrationOptions = 0;
    stubNetwork(async (request, path) => {
      if (path === PASSKEY_PATHS.LIST) {
        return success({ passkeys: [], canRemove: true });
      }
      if (path === PASSKEY_PATHS.REGISTER_OPTIONS) {
        registrationOptions += 1;
        writes.push([`${request.method} ${path}`, await request.json()]);
        if (registrationOptions === 1) {
          return refusalWith(401, ErrorCode.REAUTH_REQUIRED, { required: 'password' });
        }
        if (registrationOptions === 2) {
          return refusalWith(401, ErrorCode.REAUTH_REQUIRED, { required: 'second_factor' });
        }
        return success({ challenge: 'challenge', rp: { name: 'Test' }, user: { id: 'user' } });
      }
      if (path === PASSKEY_PATHS.REGISTER_VERIFY) {
        writes.push([`${request.method} ${path}`, await request.json()]);
        return success({ ...PASSKEY, name: 'Mac' });
      }
      return success({ methods: { password: true, passkeys: true, oauth: [] } });
    });

    const view = await renderForm('en', <PasskeysCard />);
    fireEvent.click(await screen.findByTestId('passkey-add'));
    const password = await screen.findByTestId('passkey-registration-password');
    expect(password.hasAttribute('required')).toBe(true);
    fireEvent.change(password, {
      target: { value: 'Passw0rdLayla' },
    });
    fireEvent.submit(screen.getByTestId('passkey-registration-proof-form'));

    const factor = await screen.findByTestId('passkey-registration-factor');
    expect(factor.hasAttribute('required')).toBe(true);
    fireEvent.change(factor, { target: { value: '123 456' } });
    fireEvent.submit(screen.getByTestId('passkey-registration-proof-form'));

    await screen.findByTestId('passkey-name-form');
    expect(writes).toEqual([
      ['POST /api/auth/passkeys/register/options', {}],
      ['POST /api/auth/passkeys/register/options', { password: 'Passw0rdLayla' }],
      ['POST /api/auth/passkeys/register/options', { password: 'Passw0rdLayla', code: '123456' }],
      [
        'POST /api/auth/passkeys/register/verify',
        {
          response: {
            id: 'credential',
            rawId: 'credential',
            type: 'public-key',
            response: { clientDataJSON: 'client', attestationObject: 'attestation' },
            clientExtensionResults: {},
          },
          name: view.message('settings.passkeys.deviceNames.other'),
        },
      ],
    ]);
  });

  it('does not send a recovery code after switching back to authenticator proof', async () => {
    const bodies: unknown[] = [];
    let optionsRequests = 0;
    stubNetwork(async (request, path) => {
      if (path === PASSKEY_PATHS.LIST) return success({ passkeys: [], canRemove: true });
      if (path === PASSKEY_PATHS.REGISTER_OPTIONS) {
        optionsRequests += 1;
        bodies.push(await request.json());
        return refusalWith(401, ErrorCode.REAUTH_REQUIRED, {
          required: optionsRequests === 1 ? 'password' : 'second_factor',
        });
      }
      return success({ methods: { password: true, passkeys: true, oauth: [] } });
    });
    const view = await renderForm(locale, <PasskeysCard />);

    fireEvent.click(await screen.findByTestId('passkey-add'));
    fireEvent.change(await screen.findByTestId('passkey-registration-password'), {
      target: { value: 'Passw0rdLayla' },
    });
    fireEvent.submit(screen.getByTestId('passkey-registration-proof-form'));

    fireEvent.click(
      await screen.findByRole('button', {
        name: view.message('settings.passkeys.registration.useRecoveryCode'),
      }),
    );
    fireEvent.change(await screen.findByTestId('passkey-registration-factor'), {
      target: { value: 'RECOVERY123' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: view.message('settings.passkeys.registration.useCode') }),
    );
    fireEvent.submit(screen.getByTestId('passkey-registration-proof-form'));

    await waitFor(() => expect(optionsRequests).toBe(3));
    expect(bodies).toEqual([{}, { password: 'Passw0rdLayla' }, { password: 'Passw0rdLayla' }]);
  });
});
