import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_PROOF_ENDPOINT, CSRF_ENDPOINT } from '@/constants/api';
import { ErrorCode } from '@app/core';
import { authApi } from '@/modules/auth/store/authApi';
import { CSRF_HEADER, clearBrowserProof, rememberBrowserProof } from '../browser-proof';

const WRITE_PATH = '/api/auth/forgot-password';

function refused(status: number, code: string): Response {
  return Response.json({ success: false, error: { code, message: 'refused' } }, { status });
}

function proof(token: string): Response {
  return Response.json({ success: true, data: { token } }, { headers: { [CSRF_HEADER]: token } });
}

function makeStore() {
  return configureStore({
    reducer: { [authApi.reducerPath]: authApi.reducer },
    middleware: (defaults) => defaults().concat(authApi.middleware),
  });
}

afterEach(() => {
  clearBrowserProof();
  vi.unstubAllGlobals();
});

describe('failed browser proof acquisition', () => {
  it('returns a csrf lookup failure without asking for a pre-session proof or sending the write', async () => {
    clearBrowserProof();
    const paths: string[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === CSRF_ENDPOINT) return refused(503, ErrorCode.INTERNAL_ERROR);
      throw new Error(`Unexpected path: ${path}`);
    });

    const result = await makeStore().dispatch(
      authApi.endpoints.forgotPassword.initiate({ email: 'layla@example.com' }),
    );

    expect(result.error).toMatchObject({ status: 503 });
    expect(paths).toEqual([CSRF_ENDPOINT]);
  });

  it.each([
    ['refused', () => refused(429, ErrorCode.RATE_LIMIT_EXCEEDED), 429],
    [
      'unreachable',
      () => {
        throw new TypeError('Failed to fetch');
      },
      'FETCH_ERROR',
    ],
  ] as const)(
    'returns the %s proof failure without sending the write',
    async (_label, answer, status) => {
      clearBrowserProof();
      const paths: string[] = [];
      vi.stubGlobal('fetch', async (request: Request) => {
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (path === CSRF_ENDPOINT) return refused(401, ErrorCode.SESSION_REQUIRED);
        if (path === BROWSER_PROOF_ENDPOINT) return answer();
        throw new Error(`Unexpected path: ${path}`);
      });

      const result = await makeStore().dispatch(
        authApi.endpoints.forgotPassword.initiate({ email: 'layla@example.com' }),
      );

      expect(result.error).toMatchObject({ status });
      expect(paths).toEqual([CSRF_ENDPOINT, BROWSER_PROOF_ENDPOINT]);
    },
  );

  it('returns a malformed proof answer as an error without sending the write', async () => {
    clearBrowserProof();
    const paths: string[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === CSRF_ENDPOINT) return refused(401, ErrorCode.SESSION_REQUIRED);
      if (path === BROWSER_PROOF_ENDPOINT) return Response.json({ success: true, data: {} });
      throw new Error(`Unexpected path: ${path}`);
    });

    const result = await makeStore().dispatch(
      authApi.endpoints.forgotPassword.initiate({ email: 'layla@example.com' }),
    );

    expect(result.error).toMatchObject({ status: 'CUSTOM_ERROR' });
    expect(paths).toEqual([CSRF_ENDPOINT, BROWSER_PROOF_ENDPOINT]);
  });

  it('acquires proof and sends a later retry after an earlier proof refusal', async () => {
    clearBrowserProof();
    const requests: Array<{ path: string; proof: string | null }> = [];
    let proofAttempts = 0;
    vi.stubGlobal('fetch', async (request: Request) => {
      const path = new URL(request.url).pathname;
      requests.push({ path, proof: request.headers.get(CSRF_HEADER) });
      if (path === CSRF_ENDPOINT) return refused(401, ErrorCode.SESSION_REQUIRED);
      if (path === BROWSER_PROOF_ENDPOINT) {
        proofAttempts += 1;
        return proofAttempts === 1
          ? refused(429, ErrorCode.RATE_LIMIT_EXCEEDED)
          : proof('second-proof');
      }
      if (path === WRITE_PATH) return Response.json({ success: true, data: { message: 'sent' } });
      throw new Error(`Unexpected path: ${path}`);
    });
    const store = makeStore();

    const first = await store.dispatch(
      authApi.endpoints.forgotPassword.initiate({ email: 'first@example.com' }),
    );
    expect(first.error).toMatchObject({ status: 429 });

    const second = await store.dispatch(
      authApi.endpoints.forgotPassword.initiate({ email: 'second@example.com' }),
    );
    expect(second.error).toBeUndefined();
    expect(requests).toEqual([
      { path: CSRF_ENDPOINT, proof: null },
      { path: BROWSER_PROOF_ENDPOINT, proof: null },
      { path: BROWSER_PROOF_ENDPOINT, proof: null },
      { path: WRITE_PATH, proof: 'second-proof' },
    ]);
  });

  it('stops a CSRF retry if replacement proof cannot be acquired', async () => {
    clearBrowserProof();
    rememberBrowserProof('stale-session-proof', 'session');
    const paths: string[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === WRITE_PATH) return refused(403, ErrorCode.CSRF_INVALID);
      if (path === CSRF_ENDPOINT) return refused(503, ErrorCode.INTERNAL_ERROR);
      throw new Error(`Unexpected path: ${path}`);
    });

    const result = await makeStore().dispatch(
      authApi.endpoints.forgotPassword.initiate({ email: 'layla@example.com' }),
    );

    expect(result.error).toMatchObject({ status: 503 });
    expect(paths).toEqual([WRITE_PATH, CSRF_ENDPOINT]);
  });
});
