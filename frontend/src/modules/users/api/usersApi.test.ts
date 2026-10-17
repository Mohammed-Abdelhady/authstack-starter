import { configureStore } from '@reduxjs/toolkit';
import { afterEach, expect, test, vi } from 'vitest';
import { BROWSER_PROOF_ENDPOINT, CSRF_ENDPOINT } from '@/constants/api';
import { CSRF_HEADER, clearBrowserProof } from '@/store/api/browser-proof';
import { usersApi } from './usersApi';
import { requireObservedVersion } from '@/modules/auth/utils/observedVersion';

afterEach(() => {
  clearBrowserProof();
  vi.unstubAllGlobals();
});

test('a bodyless delete refreshes users using the admin response envelope and pending email', async () => {
  clearBrowserProof();
  let deleted = false;
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(request.method);
    const pathname = new URL(request.url).pathname;
    if (pathname === CSRF_ENDPOINT) {
      return Response.json(
        { success: true, data: { token: 'session-proof-token' } },
        { headers: { [CSRF_HEADER]: 'session-proof-token' } },
      );
    }
    if (pathname === BROWSER_PROOF_ENDPOINT) {
      throw new Error('a signed-in request must not ask for a pre-session proof');
    }
    if (request.method === 'DELETE') {
      expect(pathname).toBe('/api/admin/users/fixture-user');
      expect(new URL(request.url).searchParams.get('version')).toBe('0');
      expect(request.headers.get(CSRF_HEADER)).toBe('session-proof-token');
      deleted = true;
      return new Response(null, { status: 204 });
    }
    return Response.json({
      success: true,
      data: {
        data: [
          {
            id: 'fixture-user',
            name: 'Fixture User',
            email: 'confirmed@example.test',
            role: 'support',
            version: 0,
            isVerified: true,
            isDeleted: deleted,
            pendingEmail: deleted ? 'pending@example.test' : null,
            authProvider: 'email',
            linkedProviders: [],
            createdAt: '2026-10-01T12:00:00.000Z',
            updatedAt: '2026-10-01T12:00:00.000Z',
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
    });
  });
  const store = configureStore({
    reducer: { [usersApi.reducerPath]: usersApi.reducer },
    middleware: (defaults) => defaults().concat(usersApi.middleware),
  });
  const list = store.dispatch(usersApi.endpoints.getUsers.initiate({}));
  try {
    const initial = await list.unwrap();
    expect(initial.users).toHaveLength(1);
    expect(initial).toMatchObject({
      users: [{ email: 'confirmed@example.test', isVerified: true, pendingEmail: null }],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    const observed = initial.users[0];
    if (!observed) throw new Error('Expected listed user');
    const result = await store.dispatch(
      usersApi.endpoints.deleteUser.initiate({
        userId: observed._id,
        version: requireObservedVersion(observed.version),
      }),
    );
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('data', null);
    await vi.waitFor(() => {
      expect(usersApi.endpoints.getUsers.select({})(store.getState()).data?.users).toMatchObject([
        {
          _id: 'fixture-user',
          isDeleted: true,
          isVerified: true,
          email: 'confirmed@example.test',
          pendingEmail: 'pending@example.test',
        },
      ]);
    });
    expect(requests).toEqual(['GET', 'GET', 'DELETE', 'GET']);
  } finally {
    list.unsubscribe();
    store.dispatch(usersApi.util.resetApiState());
  }
});
