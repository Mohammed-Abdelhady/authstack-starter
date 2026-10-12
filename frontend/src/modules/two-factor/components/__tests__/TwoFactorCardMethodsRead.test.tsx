// @vitest-environment jsdom
import { vi } from 'vitest';
import { describeMethodsRead } from '@/modules/auth/__tests__/methodsReadCases';
import { registerFormTestLifecycle } from '@/tests/serverRejectionHarness';
import { TwoFactorCard } from '../TwoFactorCard';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  twoFactorEnabled: false,
  linkedProviders: ['email'],
};

registerFormTestLifecycle();

describeMethodsRead('the two-step verification card', {
  card: <TwoFactorCard />,
  method: 'twoFactor',
  titleKey: 'settings.twoFactor.title',
  workingButtonKey: 'settings.twoFactor.setup.open',
  otherReads: () => USER,
});
