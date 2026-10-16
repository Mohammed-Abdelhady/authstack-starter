import { configureStore } from '@reduxjs/toolkit';
import type { BaseQueryApi } from '@reduxjs/toolkit/query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, parseApiError } from '@app/core';
import { authApi } from '@/modules/auth/store/authApi';
import { usersApi } from '@/modules/users/api/usersApi';
import { browserBaseQuery } from '../baseApi';
import { clearBrowserProof, rememberBrowserProof } from '../browser-proof';
import { invalidateOnSuccessOrUnknownOutcome } from '../invalidateOnSuccess';

function makeStore() {
  return configureStore({
    reducer: { [authApi.reducerPath]: authApi.reducer },
    middleware: (defaults) => defaults().concat(authApi.middleware),
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
    type: 'query',
  };
}

afterEach(() => {
  clearBrowserProof();
  vi.unstubAllGlobals();
});

describe('the SDK transport through the RTK adapter', () => {
  it('keeps a 401 as signed out with its server code and request id', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        {
          success: false,
          error: { code: ErrorCode.SESSION_INVALID, message: 'expired' },
          requestId: 'request-expired',
        },
        { status: 401 },
      ),
    );

    const result = await makeStore().dispatch(authApi.endpoints.getCurrentUser.initiate());

    expect(result.error).toMatchObject({
      status: 401,
      code: ErrorCode.SESSION_INVALID,
      requestId: 'request-expired',
      unknownOutcome: false,
    });
    expect(parseApiError(result.error).statusCode).toBe(401);
  });

  it.each([
    [409, ErrorCode.CONFLICT, undefined],
    [400, ErrorCode.VALIDATION_ERROR, { 'profile.email': ['invalid format', 'already in use'] }],
  ] as const)(
    'keeps status %s, fields and the raw server envelope',
    async (status, code, fields) => {
      const body = {
        success: false,
        error: { code, message: 'refused', details: { fields } },
        requestId: 'request-refused',
      };
      vi.stubGlobal('fetch', async () => Response.json(body, { status }));

      const result = await makeStore().dispatch(authApi.endpoints.getCurrentUser.initiate());

      expect(result.error).toEqual({
        status,
        code,
        fields,
        requestId: 'request-refused',
        data: {
          success: false,
          error: { code, message: 'refused', details: fields ? { fields } : {} },
          requestId: 'request-refused',
        },
        unknownOutcome: false,
      });
      if (status === 400) {
        expect(parseApiError(result.error).fieldErrors).toEqual({
          'profile.email': ['invalid format', 'already in use'],
        });
      }
      expect(JSON.parse(JSON.stringify(result.error))).toMatchObject({ status, code });
    },
  );

  it('forwards cancellation to the actual in-flight I/O', async () => {
    const controller = new AbortController();
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (request: Request) => {
      observedSignal = request.signal;
      notifyStarted();
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        });
      });
    });

    const pending = browserBaseQuery('/api/user/profile', queryApi(controller.signal), {});
    await started;
    controller.abort();
    const result = await pending;

    expect(observedSignal?.aborted).toBe(true);
    expect(result.error).toMatchObject({
      status: 'CUSTOM_ERROR',
      code: 'REQUEST_ABORTED',
      unknownOutcome: false,
    });
  });

  it('returns the role response as a partial result without inventing an account', async () => {
    rememberBrowserProof('session-proof', 'session');
    vi.stubGlobal('fetch', async () =>
      Response.json({ success: true, data: { id: 'user-2', role: 'admin' } }),
    );

    const result = await makeStore()
      .dispatch(usersApi.endpoints.updateUserRole.initiate({ userId: 'user-2', role: 'admin' }))
      .unwrap();

    expect(result).toEqual({ id: 'user-2', role: 'admin' });
  });

  it('refreshes sensitive reads when a successful HTTP write has an unreadable answer', async () => {
    rememberBrowserProof('session-proof', 'session');
    vi.stubGlobal('fetch', async () => new Response('<html>proxy</html>', { status: 200 }));

    const result = await browserBaseQuery(
      { url: '/api/admin/users/user-2/role', method: 'PATCH', body: { role: 'admin' } },
      queryApi(new AbortController().signal),
      {},
    );

    expect(result.error).toMatchObject({
      status: 'PARSING_ERROR',
      originalStatus: 200,
      data: '<html>proxy</html>',
      unknownOutcome: true,
    });
    const invalidate = invalidateOnSuccessOrUnknownOutcome([{ type: 'User', id: 'user-2' }]);
    expect(invalidate(undefined, result.error, undefined)).toEqual([
      { type: 'User', id: 'user-2' },
    ]);
  });
});
