// @vitest-environment jsdom
import { vi } from 'vitest';
import { describeMethodsRead } from '@/modules/auth/__tests__/methodsReadCases';
import { registerFormTestLifecycle } from '@/tests/serverRejectionHarness';
import { ChangePasswordCard } from '../ChangePasswordCard';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

registerFormTestLifecycle();

describeMethodsRead('the change password card', {
  card: <ChangePasswordCard />,
  method: 'password',
  titleKey: 'settings.password.title',
  workingButtonKey: 'settings.password.submit',
  otherReads: () => ({}),
});
