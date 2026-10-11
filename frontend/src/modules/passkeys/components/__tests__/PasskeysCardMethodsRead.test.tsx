// @vitest-environment jsdom
import { vi } from 'vitest';
import { describeMethodsRead } from '@/modules/auth/__tests__/methodsReadCases';
import { registerFormTestLifecycle } from '@/tests/serverRejectionHarness';
import { PasskeysCard } from '../PasskeysCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// The browser ceremony is the boundary: jsdom has no authenticator.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  platformAuthenticatorIsAvailable: async () => true,
  startRegistration: vi.fn(),
}));

registerFormTestLifecycle();

describeMethodsRead('the passkeys card', {
  card: <PasskeysCard />,
  method: 'passkeys',
  titleKey: 'settings.passkeys.title',
  workingButtonKey: 'settings.passkeys.add',
  otherReads: () => ({ passkeys: [], canRemove: true }),
});
