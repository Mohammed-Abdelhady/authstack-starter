// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import {
  makeStore,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { clickTwiceInOneTick } from '../../__tests__/submitTwice';
import { LogoutButton } from '../LogoutButton';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
// jsdom follows a fragment and nothing else, so the sign-in address is one here.
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href }: { href: string }) => `#${href}`,
}));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};

registerFormTestLifecycle();
afterEach(() => {
  window.location.hash = '';
});

describe('sign-out button', () => {
  it('signs out once when it is activated twice in one tick', async () => {
    const requests = stubNetwork(() => success({ message: 'Signed out' }));
    const store = makeStore();
    store.dispatch(loginFulfilled(USER));
    const { message, successToasts } = await renderForm('en', <LogoutButton />, store);

    clickTwiceInOneTick(screen.getByRole('button', { name: message('auth.activate.logout') }));

    await waitFor(() => expect(successToasts()).toEqual([message('toast.success.logoutSuccess')]));
    expect(requests).toEqual(['POST /api/auth/logout']);
    expect(window.location.hash).toBe('#/auth/login');
  });
});
