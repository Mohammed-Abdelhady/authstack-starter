// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { USER_PERMISSIONS } from '@app/core';
import { AuthGuard } from '@/components/providers/AuthGuard';
import {
  makeStore,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { logout, loginFulfilled } from './authSlice';
import { authApi } from './authApi';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const PROFILE = {
  id: 'user-1',
  email: 'ada@example.test',
  name: 'Ada Lovelace',
  role: 'admin',
  permissions: Object.values(USER_PERMISSIONS),
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false,
  passkeyCount: 0,
  linkedProviders: ['email'],
  locale: 'en',
};

registerFormTestLifecycle();

describe('identity response ordering', () => {
  it('does not let a held signed-out bootstrap erase a confirmed login', async () => {
    const identityReplies: Array<(response: Response) => void> = [];
    stubNetwork((_request, path) => {
      if (path === '/api/auth/identity') {
        return new Promise<Response>((resolve) => identityReplies.push(resolve));
      }
      if (path === '/api/auth/login') {
        return success({ requiresTwoFactor: false, user: PROFILE });
      }
      return success({});
    });

    const store = makeStore();
    await renderForm(
      'en',
      <AuthGuard>
        <div data-testid="protected-content" />
      </AuthGuard>,
      store,
    );

    await waitFor(() => expect(identityReplies).toHaveLength(1));
    await act(async () => {
      await store
        .dispatch(authApi.endpoints.login.initiate({ email: PROFILE.email, password: 'pass' }))
        .unwrap();
    });
    expect(screen.getByTestId('protected-content')).toBeTruthy();

    await act(async () => identityReplies[0](success({ authenticated: false, user: null })));
    await waitFor(() => expect(identityReplies).toHaveLength(2));

    const authWhileFreshIdentityIsPending = store.getState().auth;
    const redirectCount = pushMock.mock.calls.length;
    await act(async () => identityReplies[1](success({ authenticated: true, user: PROFILE })));

    expect(authWhileFreshIdentityIsPending).toMatchObject({
      user: { id: PROFILE.id, email: PROFILE.email },
      isAuthenticated: true,
      validationStatus: 'succeeded',
    });
    expect(redirectCount).toBe(0);
  });

  it('does not restore a session from an identity response held across logout', async () => {
    const identityReplies: Array<(response: Response) => void> = [];
    stubNetwork((_request, path) => {
      if (path === '/api/auth/identity') {
        return new Promise<Response>((resolve) => identityReplies.push(resolve));
      }
      return success({});
    });
    const store = makeStore();
    store.dispatch(loginFulfilled(PROFILE));
    const identityRead = store.dispatch(
      authApi.endpoints.getIdentity.initiate(undefined, { forceRefetch: true }),
    );
    await waitFor(() => expect(identityReplies).toHaveLength(1));

    store.dispatch(logout());
    identityReplies[0](success({ authenticated: true, user: PROFILE }));
    await identityRead.unwrap();

    expect(store.getState().auth).toMatchObject({
      user: null,
      isAuthenticated: false,
      validationStatus: 'idle',
    });
  });
});
