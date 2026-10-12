// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@app/core';
import {
  currentBrowserProof,
  csrfLookupHint,
  rememberBrowserProof,
} from '@/store/api/browser-proof';
import {
  makeStore,
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { authApi } from '@/modules/auth/store/authApi';
import { setUser } from '@/modules/auth/store/authSlice';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const IDENTITY_PATH = '/api/auth/identity';
const PROFILE = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: ['profile:read'],
  authProvider: 'email',
  isVerified: true,
  // feature:totp:start
  twoFactorEnabled: false,
  // feature:totp:end
  // feature:passkeys:start
  passkeyCount: 0,
  // feature:passkeys:end
  linkedProviders: ['email'],
};
const SIGNED_IN = { authenticated: true, user: PROFILE } as const;
const SIGNED_OUT = { authenticated: false, user: null } as const;

registerFormTestLifecycle();

describe('optional identity bootstrap', () => {
  it('unwraps the actual signed-in API envelope into auth state', async () => {
    const requests = stubNetwork((_request, path) =>
      path === IDENTITY_PATH ? success(SIGNED_IN) : success({}),
    );
    const store = makeStore();

    const identity = await store.dispatch(authApi.endpoints.getIdentity.initiate()).unwrap();

    expect(identity).toEqual(SIGNED_IN);
    expect(requests).toEqual([`GET ${IDENTITY_PATH}`]);
    expect(store.getState().auth).toMatchObject({
      user: {
        id: PROFILE.id,
        email: PROFILE.email,
        name: PROFILE.name,
        permissions: PROFILE.permissions,
      },
      isAuthenticated: true,
      validationStatus: 'succeeded',
      validationErrorStatus: null,
    });
  });

  it('settles signed-out state and uses a pre-session proof after the identity reply', async () => {
    rememberBrowserProof('stale-session-proof', 'session');
    const requests = stubNetwork((_request, path) =>
      path === IDENTITY_PATH ? success(SIGNED_OUT) : success({ message: 'accepted' }),
    );
    const store = makeStore();
    store.dispatch(setUser(PROFILE));

    const identity = await store.dispatch(authApi.endpoints.getIdentity.initiate()).unwrap();
    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: PROFILE.email }))
      .unwrap();

    expect(identity).toEqual(SIGNED_OUT);
    expect(store.getState().auth).toMatchObject({
      user: null,
      isAuthenticated: false,
      validationStatus: 'succeeded',
      validationErrorStatus: null,
    });
    expect(currentBrowserProof()).toBe('');
    expect(csrfLookupHint()).toBe('no-session');
    expect(requests.allRequests).toEqual([
      `GET ${IDENTITY_PATH}`,
      'GET /api/auth/browser-proof',
      'POST /api/auth/forgot-password',
    ]);
  });

  it.each([
    ['service unavailable', () => refusalWith(503, 'AUTHORITY_UNAVAILABLE')],
    ['mixed credentials', () => refusalWith(400, ErrorCode.VALIDATION_ERROR)],
  ] as const)('keeps a validated account when identity has %s', async (_label, refuse) => {
    let reads = 0;
    const store = makeStore();
    stubNetwork((_request, path) => {
      if (path !== IDENTITY_PATH) return success({});
      reads += 1;
      return reads === 1 ? success(SIGNED_IN) : refuse();
    });

    await store.dispatch(authApi.endpoints.getIdentity.initiate());
    await store.dispatch(authApi.endpoints.getIdentity.initiate(undefined, { forceRefetch: true }));

    expect(store.getState().auth).toMatchObject({
      user: {
        id: PROFILE.id,
        name: PROFILE.name,
      },
      isAuthenticated: true,
      validationStatus: 'succeeded',
      validationErrorStatus: null,
      isLoading: false,
    });
  });

  it('does not fall back to the profile or repeat identity after an invalid bearer reply', async () => {
    const requests = stubNetwork((_request, path) =>
      path === IDENTITY_PATH ? refusalWith(401, ErrorCode.SESSION_INVALID) : success(PROFILE),
    );
    const store = makeStore();
    store.dispatch(setUser(PROFILE));

    await store.dispatch(authApi.endpoints.getIdentity.initiate());
    await Promise.all(store.dispatch(authApi.util.getRunningQueriesThunk()));

    expect(requests.allRequests).toEqual([`GET ${IDENTITY_PATH}`]);
    expect(store.getState().auth).toMatchObject({
      user: null,
      isAuthenticated: false,
      validationStatus: 'failed',
      validationErrorStatus: 401,
    });
  });
});
