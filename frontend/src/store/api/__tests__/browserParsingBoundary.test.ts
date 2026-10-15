import { configureStore } from '@reduxjs/toolkit';
import type { BaseQueryApi } from '@reduxjs/toolkit/query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSRF_ENDPOINT } from '@app/sdk';
import { ErrorCode } from '@app/core';
import { toast } from '@/lib/toast';
import { usersApi } from '@/modules/users/api/usersApi';
import { errorInterceptor } from '@/store/middleware/errorInterceptor';
import { browserBaseQuery } from '../baseApi';
import { clearBrowserProof } from '../browser-proof';
import { createIdentityFence } from '../identity-fence';
import { invalidateOnSuccessOrUnknownOutcome } from '../invalidateOnSuccess';

vi.mock('@/lib/toast', () => ({ toast: { show: vi.fn(), dismiss: vi.fn() } }));

const PROXY_PAGE = '<html>proxy error page</html>';
const USER_PATH = '/api/admin/users/user-2';
const ACCOUNT = {
  id: 'user-2',
  name: 'Mona',
  email: 'mona@example.com',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  isDeleted: false,
  linkedProviders: ['email'],
};

function makeStore() {
  return configureStore({
    reducer: { [usersApi.reducerPath]: usersApi.reducer },
    middleware: (defaults) => defaults().concat(errorInterceptor, usersApi.middleware),
  });
}

function queryApi(signal: AbortSignal): BaseQueryApi {
  return {
    signal,
    abort: () => undefined,
    dispatch: makeStore().dispatch,
    getState: () => ({}),
    extra: undefined,
    endpoint: 'transportProbe',
    type: 'mutation',
  };
}

afterEach(() => {
  clearBrowserProof();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('browser adapter failure handoffs', () => {
  it('keeps a successful HTML read quiet through the real error interceptor', async () => {
    vi.stubGlobal('fetch', async () => new Response(PROXY_PAGE, { status: 200 }));

    const result = await makeStore().dispatch(usersApi.endpoints.getUsers.initiate({}));

    expect(result.error).toMatchObject({
      status: 'PARSING_ERROR',
      originalStatus: 200,
      data: '<html>proxy error page</html>',
      unknownOutcome: false,
    });
    expect(vi.mocked(toast.show).mock.calls).toEqual([]);
  });

  it.each([401, 403, 503])('keeps malformed HTTP %s in its original class', async (status) => {
    vi.stubGlobal('fetch', async () => new Response(PROXY_PAGE, { status }));

    const result = await browserBaseQuery(USER_PATH, queryApi(new AbortController().signal), {});

    expect(result.error).toMatchObject({
      status: 'PARSING_ERROR',
      originalStatus: status,
      data: '<html>proxy error page</html>',
      unknownOutcome: false,
    });
  });

  it('does not refetch subscribed accounts when proof acquisition fails before dispatch', async () => {
    const paths: string[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      return path === CSRF_ENDPOINT
        ? Response.json(
            {
              success: false,
              error: { code: ErrorCode.AUTHORITY_UNAVAILABLE, message: 'unavailable' },
            },
            { status: 503 },
          )
        : Response.json({
            success: true,
            data: ACCOUNT,
          });
    });
    const store = makeStore();
    await store.dispatch(usersApi.endpoints.getUserById.initiate('user-2'));

    const result = await store.dispatch(
      usersApi.endpoints.updateUserRole.initiate({ userId: 'user-2', role: 'admin' }),
    );
    await Promise.all(store.dispatch(usersApi.util.getRunningQueriesThunk()));

    expect(result.error).toMatchObject({ status: 503, unknownOutcome: false });
    expect(paths).toEqual(['/api/admin/users/user-2', '/api/auth/csrf']);
  });

  it('does not invalidate sensitive reads for cancellation before dispatch', async () => {
    const fetchPort = vi.fn();
    vi.stubGlobal('fetch', fetchPort);
    const controller = new AbortController();
    controller.abort();

    const result = await browserBaseQuery(
      { url: `${USER_PATH}/role`, method: 'PATCH', body: { role: 'admin' } },
      queryApi(controller.signal),
      {},
    );

    expect(result.error).toMatchObject({ code: 'REQUEST_ABORTED', unknownOutcome: false });
    const invalidate = invalidateOnSuccessOrUnknownOutcome([{ type: 'User', id: 'user-2' }]);
    expect(invalidate(undefined, result.error, undefined)).toEqual([]);
    expect(fetchPort.mock.calls).toEqual([]);
  });

  it('compares the supplied identity snapshot with current state', () => {
    let generation = 1;
    const fence = createIdentityFence(() => ({
      auth: {
        sessionGeneration: generation,
        identityRequest: { requestId: `identity-${generation}`, sessionGeneration: generation },
      },
    }));
    const oldSnapshot = fence.snapshot();
    generation = 2;
    const newSnapshot = fence.snapshot();

    expect(fence.isCurrent(oldSnapshot)).toBe(false);
    expect(fence.isCurrent(newSnapshot)).toBe(true);
    expect(fence.isCurrent(null)).toBe(false);
  });
});
