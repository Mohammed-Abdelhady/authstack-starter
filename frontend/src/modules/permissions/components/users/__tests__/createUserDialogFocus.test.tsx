// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { focusAfterOpenAndEscape } from '@/tests/dialogFocus';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { CreateUserButton } from '../CreateUserButton';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

it('returns focus to the add user button when the create user dialog is closed', async () => {
  stubNetwork(() => success({ roles: [], total: 0, page: 1 }));
  await renderForm('en', <CreateUserButton />);

  expect(await focusAfterOpenAndEscape('create-user-button', 'create-user-dialog')).toBe(
    'create-user-button',
  );
});
