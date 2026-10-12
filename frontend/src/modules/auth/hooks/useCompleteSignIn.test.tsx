// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { Provider } from 'react-redux';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  makeStore,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { setUser } from '../store/authSlice';
import { useCompleteSignIn } from './useCompleteSignIn';

const { replaceMock, pushMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const IDENTITY_PATH = '/api/auth/identity';
const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false,
  passkeyCount: 0,
  linkedProviders: ['email'],
};

registerFormTestLifecycle();

function identityEnvelope(authenticated: boolean) {
  return authenticated
    ? success({ authenticated: true, user: USER })
    : success({ authenticated: false, user: null });
}

function wrapperFor(store: ReturnType<typeof makeStore>) {
  return function StoreWrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe('useCompleteSignIn identity fallback', () => {
  it('routes only after the identity endpoint confirms the session', async () => {
    const requests = stubNetwork((_request, path) =>
      path === IDENTITY_PATH ? identityEnvelope(true) : success({}),
    );
    const store = makeStore();
    const { result } = renderHook(() => useCompleteSignIn(), { wrapper: wrapperFor(store) });

    await act(async () => {
      await result.current({ requiresTwoFactor: false, user: null }, '/account');
    });

    expect(requests).toEqual([`GET ${IDENTITY_PATH}`]);
    expect(replaceMock).toHaveBeenCalledWith('/account');
    expect(store.getState().auth.isAuthenticated).toBe(true);
  });

  it('does not navigate when a successful response says the browser is signed out', async () => {
    const requests = stubNetwork((_request, path) =>
      path === IDENTITY_PATH ? identityEnvelope(false) : success({}),
    );
    const store = makeStore();
    const { result } = renderHook(() => useCompleteSignIn(), { wrapper: wrapperFor(store) });

    await act(async () => {
      await expect(
        result.current({ requiresTwoFactor: false, user: null }, '/account'),
      ).rejects.toMatchObject({ status: 401 });
    });

    expect(requests).toEqual([`GET ${IDENTITY_PATH}`]);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(store.getState().auth.isAuthenticated).toBe(false);
  });

  it('does not navigate when identity is unavailable and keeps the validated user', async () => {
    const requests = stubNetwork((_request, path) =>
      path === IDENTITY_PATH
        ? Response.json(
            { success: false, error: { code: 'AUTHORITY_UNAVAILABLE', message: 'unavailable' } },
            { status: 503 },
          )
        : success({}),
    );
    const store = makeStore();
    store.dispatch(setUser(USER));
    const { result } = renderHook(() => useCompleteSignIn(), { wrapper: wrapperFor(store) });

    await act(async () => {
      await expect(
        result.current({ requiresTwoFactor: false, user: null }, '/account'),
      ).rejects.toMatchObject({ status: 503 });
    });

    expect(requests).toEqual([`GET ${IDENTITY_PATH}`]);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(store.getState().auth).toMatchObject({
      user: { id: USER.id },
      isAuthenticated: true,
      validationStatus: 'succeeded',
    });
  });

  it('uses the sign-in account directly without another identity read', async () => {
    const requests = stubNetwork(() => success({}));
    const store = makeStore();
    const { result } = renderHook(() => useCompleteSignIn(), { wrapper: wrapperFor(store) });

    await act(async () => {
      await result.current({ requiresTwoFactor: false, user: USER }, '/account');
    });

    expect(requests).toEqual([]);
    expect(replaceMock).toHaveBeenCalledWith('/account');
  });
});
