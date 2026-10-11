// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { focusAfterOpenAndEscape } from '@/tests/dialogFocus';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { TwoFactorCard } from '../TwoFactorCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  twoFactorEnabled: false,
  linkedProviders: ['email'],
};
const METHODS = {
  methods: { password: true, magicLink: false, twoFactor: true, passkeys: false, oauth: [] },
};

registerFormTestLifecycle();

it('returns focus to the set up button when the setup dialog is closed', async () => {
  stubNetwork((_request, path) => success(path === '/api/auth/methods' ? METHODS : USER));
  await renderForm('en', <TwoFactorCard />);

  expect(await focusAfterOpenAndEscape('two-factor-setup-open', 'two-factor-setup-dialog')).toBe(
    'two-factor-setup-open',
  );
});
