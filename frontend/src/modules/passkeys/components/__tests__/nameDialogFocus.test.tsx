// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { focusAfterOpenAndEscape } from '@/tests/dialogFocus';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { PasskeysCard } from '../PasskeysCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
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

it('returns focus to the rename button when the name dialog is closed, though its field took focus', async () => {
  stubNetwork((_request, path) =>
    success(
      path === '/api/auth/passkeys'
        ? { passkeys: [PASSKEY], canRemove: true }
        : { methods: { password: true, passkeys: true, oauth: [] } },
    ),
  );
  await renderForm('en', <PasskeysCard />);

  expect(await focusAfterOpenAndEscape('passkey-rename-pk-1', 'passkey-name-dialog')).toBe(
    'passkey-rename-pk-1',
  );
});
