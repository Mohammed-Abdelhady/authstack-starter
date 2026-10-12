// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { User } from '@app/sdk';
import {
  refusal,
  refusalWith,
  makeStore,
  registerFormTestLifecycle,
  identitySuccess,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { ErrorCode } from '@app/core';
import { baseApi } from '@/store/api/baseApi';
import { usersApi } from '@/modules/users/api/usersApi';
import { CONVERTED, SESSION_REVOCATIONS, SIGN_OUT } from './invalidationRefetchCases';
import { UNTAGGED } from './untaggedRefetchCases';
import {
  ADMIN_USER,
  PROFILE,
  describeSuccessOnly,
  describeUntagged,
  readProfile,
  readUser,
  readUsers,
  requestsOf,
} from './mutationSweepBase';
import { authApi } from '@/modules/auth/store/authApi';
import { sessionsApi } from '@/modules/sessions/api/sessionsApi';
// feature:passkeys:start
import { passkeysApi } from '@/modules/passkeys/api/passkeysApi';
// feature:passkeys:end
import { authMethodsApi } from '@/modules/auth/api/authMethodsApi';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

const IDENTITY_PATH = '/api/auth/identity';
const IDENTITY_USER: User = {
  ...PROFILE,
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

async function readIdentity(store: ReturnType<typeof makeStore>): Promise<void> {
  await store.dispatch(authApi.endpoints.getIdentity.initiate());
}

describeSuccessOnly(CONVERTED);
describeUntagged(UNTAGGED);

it('refetches a deleted user as 404 and reports the failed detail read', async () => {
  let deleted = false;
  const requests = stubNetwork((request, path) => {
    if (request.method === 'DELETE') {
      deleted = true;
      return success({ message: 'User deleted' });
    }
    if (path === '/api/admin/users/user-2') {
      return deleted ? refusalWith(404, ErrorCode.USER_NOT_FOUND) : success(ADMIN_USER);
    }
    if (path === '/api/admin/users') {
      const data = deleted ? [] : [ADMIN_USER];
      return success({
        data,
        pagination: { page: 1, limit: 20, total: data.length, totalPages: 1 },
      });
    }
    throw new Error(`Unexpected path: ${path}`);
  });
  const store = makeStore();
  await readUsers(store);
  await readUser(store);
  await store.dispatch(usersApi.endpoints.deleteUser.initiate('user-2'));
  await Promise.all(store.dispatch(baseApi.util.getRunningQueriesThunk()));

  expect(requests).toEqual([
    'GET /api/admin/users',
    'GET /api/admin/users/user-2',
    'DELETE /api/admin/users/user-2',
    'GET /api/admin/users',
    'GET /api/admin/users/user-2',
  ]);
  expect(usersApi.endpoints.getUserById.select('user-2')(store.getState()).error).toMatchObject({
    status: 404,
  });
  expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
});

// The success-only and untagged suites live in the shared base; the
// session-revocation suite is only used here.
describe.each(SESSION_REVOCATIONS)('$name invalidates even when refused', (mutation) => {
  it('repeats its reads after a 400 refusal', async () => {
    const requests = await requestsOf(mutation, () => refusal(['name']));
    expect(requests.slice(mutation.requests.length).sort()).toEqual([...mutation.refetched].sort());
  });

  it('also repeats its reads after the server accepted it', async () => {
    const requests = await requestsOf(mutation, () => success(mutation.accepted));
    expect(requests.slice(mutation.requests.length).sort()).toEqual([...mutation.refetched].sort());
  });
});

describe('logout', () => {
  it.each([
    ['a refusal', () => refusal(['name'])],
    [
      'a lost answer',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ] as const)('keeps a validated session after %s', async (_label, answer) => {
    stubNetwork((request, path) => {
      if (path === IDENTITY_PATH) return identitySuccess(IDENTITY_USER);
      if (request.method === 'POST') return answer();
      if (path === '/api/user/profile') return success(PROFILE);
      throw new Error(`Unexpected path: ${path}`);
    });
    const store = makeStore();
    await readIdentity(store);
    await readProfile(store);
    expect(store.getState().auth.isAuthenticated).toBe(true);

    await store.dispatch(authApi.endpoints.logout.initiate());
    await Promise.all(store.dispatch(baseApi.util.getRunningQueriesThunk()));
    expect(store.getState().auth.isAuthenticated).toBe(true);
    expect(store.getState().auth.user?.id).toBe(PROFILE.id);
  });

  it('repeats nothing after the server confirmed the sign-out', async () => {
    expect(await requestsOf(SIGN_OUT, () => success(SIGN_OUT.accepted))).toEqual([
      'GET /api/user/profile',
      'POST /api/auth/logout',
    ]);
  });

  it('asks for the profile again after a refused sign-out', async () => {
    const requests = await requestsOf(SIGN_OUT, () => refusal(['name']));
    expect(requests.slice(0, SIGN_OUT.requests.length)).toEqual(SIGN_OUT.requests);
    expect(requests.slice(SIGN_OUT.requests.length).sort()).toEqual([...SIGN_OUT.refetched].sort());
  });

  it('checks the profile after a lost sign-out answer', async () => {
    const requests = await requestsOf(SIGN_OUT, () => {
      throw new TypeError('Failed to fetch');
    });
    expect(requests).toEqual([
      'GET /api/user/profile',
      'POST /api/auth/logout',
      'GET /api/user/profile',
    ]);
  });

  it.each([
    ['a refusal', () => refusal(['name'])],
    [
      'a lost answer',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ] as const)('refetches each subscribed session-owned read after %s', async (_label, answer) => {
    const requests = stubNetwork((request, path) => {
      if (path === IDENTITY_PATH) return identitySuccess(IDENTITY_USER);
      if (request.method === 'POST') return answer();
      if (path === '/api/user/profile') return success(PROFILE);
      if (path === '/api/user/sessions') return success({ sessions: [] });
      // feature:passkeys:start
      if (path === '/api/auth/passkeys') return success({ passkeys: [], canRemove: true });
      // feature:passkeys:end
      if (path === '/api/auth/methods')
        return success({
          methods: {
            password: true,
            magicLink: true,
            twoFactor: false,
            passkeys: true,
            oauth: [],
          },
        });
      throw new Error(`Unexpected path: ${path}`);
    });
    const store = makeStore();
    await readIdentity(store);
    await readProfile(store);
    await store.dispatch(sessionsApi.endpoints.getSessions.initiate());
    // feature:passkeys:start
    await store.dispatch(passkeysApi.endpoints.getPasskeys.initiate());
    // feature:passkeys:end
    await store.dispatch(authMethodsApi.endpoints.getAuthMethods.initiate());

    await store.dispatch(authApi.endpoints.logout.initiate());
    await Promise.all(store.dispatch(baseApi.util.getRunningQueriesThunk()));

    const reads = [
      'GET /api/auth/identity',
      'GET /api/user/profile',
      'GET /api/user/sessions',
      // feature:passkeys:start
      'GET /api/auth/passkeys',
      // feature:passkeys:end
      'GET /api/auth/methods',
    ];
    const refetchedReads = [
      'GET /api/auth/identity',
      'GET /api/user/profile',
      'GET /api/user/sessions',
      // feature:passkeys:start
      'GET /api/auth/passkeys',
      // feature:passkeys:end
      'GET /api/auth/methods',
    ];
    expect(requests.slice(0, reads.length + 1)).toEqual([...reads, 'POST /api/auth/logout']);
    expect(requests.slice(reads.length + 1).sort()).toEqual([...refetchedReads].sort());
    expect(store.getState().auth.isAuthenticated).toBe(true);
  });
});
