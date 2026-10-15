import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_PROOF_ENDPOINT, CSRF_ENDPOINT } from '@app/sdk';
import { LOGOUT_ENDPOINT } from '@/constants/api';
import { ErrorCode } from '@app/core';
import { authApi } from '@/modules/auth/store/authApi';
import {
  CSRF_HEADER,
  clearBrowserProof,
  currentBrowserProof,
  rememberBrowserProof,
} from '../browser-proof';

interface RecordedRequest {
  method: string;
  pathname: string;
  proof: string | null;
}

type FetchHandler = (request: Request) => Response;

function installFetch(handler: FetchHandler): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push({
      method: request.method,
      pathname: new URL(request.url).pathname,
      proof: request.headers.get(CSRF_HEADER),
    });
    return handler(request);
  });
  return requests;
}

function proofResponse(token: string): Response {
  return Response.json({ success: true, data: { token } }, { headers: { [CSRF_HEADER]: token } });
}

function proofError(code: string): Response {
  return Response.json(
    { success: false, error: { code, message: 'proof failed' } },
    { status: 403 },
  );
}

function okResponse(): Response {
  return Response.json({ success: true, data: { message: 'ok' } });
}

function makeStore() {
  return configureStore({
    reducer: { [authApi.reducerPath]: authApi.reducer },
    middleware: (defaults) => defaults().concat(authApi.middleware),
  });
}

// A URL that merely contains the logout path must not be treated as logout.
const logoutLikeApi = authApi.injectEndpoints({
  endpoints: (builder) => ({
    touchLogoutPath: builder.mutation<{ message: string }, void>({
      query: () => ({ url: `${LOGOUT_ENDPOINT}-like`, method: 'POST' }),
    }),
  }),
});

afterEach(() => {
  clearBrowserProof();
  vi.unstubAllGlobals();
});

describe('browser proof through the base query', () => {
  it('fetches a new pre-session proof for the second anonymous unsafe request', async () => {
    clearBrowserProof();
    let proofIssued = 0;
    const requests = installFetch((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === CSRF_ENDPOINT) {
        return proofError(ErrorCode.CSRF_INVALID);
      }
      if (pathname === BROWSER_PROOF_ENDPOINT) {
        proofIssued += 1;
        return proofResponse(`proof-${proofIssued}`);
      }
      return okResponse();
    });
    const store = makeStore();

    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'first@example.com' }))
      .unwrap();
    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'second@example.com' }))
      .unwrap();

    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts.map((request) => request.proof)).toEqual(['proof-1', 'proof-2']);
    expect(proofIssued).toBe(2);
    expect(currentBrowserProof()).toBe('');
  });

  it('fetches a fresh proof and retries once before surfacing a second CSRF_INVALID', async () => {
    clearBrowserProof();
    let proofIssued = 0;
    const requests = installFetch((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === CSRF_ENDPOINT) {
        return proofError(ErrorCode.CSRF_INVALID);
      }
      if (pathname === BROWSER_PROOF_ENDPOINT) {
        proofIssued += 1;
        return proofResponse(`proof-${proofIssued}`);
      }
      return proofError(ErrorCode.CSRF_INVALID);
    });
    const store = makeStore();

    const result = await store.dispatch(
      authApi.endpoints.forgotPassword.initiate({ email: 'retry@example.com' }),
    );

    expect(result.error).toMatchObject({
      status: 403,
      data: { success: false, error: { code: ErrorCode.CSRF_INVALID } },
    });
    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts.map((request) => request.proof)).toEqual(['proof-1', 'proof-2']);
    expect(proofIssued).toBe(2);
    expect(currentBrowserProof()).toBe('');
  });

  it('clears the holder when logout passes through the real base query', async () => {
    clearBrowserProof();
    rememberBrowserProof('session-proof', 'session');
    const requests = installFetch(() => okResponse());
    const store = makeStore();

    const result = await store.dispatch(authApi.endpoints.logout.initiate());

    expect(result.error).toBeUndefined();
    const logout = requests.find((request) => request.pathname === LOGOUT_ENDPOINT);
    expect(logout?.proof).toBe('session-proof');
    expect(currentBrowserProof()).toBe('');
  });

  it('sends a different pre-session proof for each concurrent anonymous request', async () => {
    clearBrowserProof();
    let proofIssued = 0;
    const requests = installFetch((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === CSRF_ENDPOINT) {
        return proofError(ErrorCode.CSRF_INVALID);
      }
      if (pathname === BROWSER_PROOF_ENDPOINT) {
        proofIssued += 1;
        return proofResponse(`proof-${proofIssued}`);
      }
      return okResponse();
    });
    const store = makeStore();

    const first = store.dispatch(
      authApi.endpoints.forgotPassword.initiate({ email: 'one@example.com' }),
    );
    const second = store.dispatch(
      authApi.endpoints.forgotPassword.initiate({ email: 'two@example.com' }),
    );
    await Promise.all([first.unwrap(), second.unwrap()]);

    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map((request) => request.proof).sort()).toEqual(['proof-1', 'proof-2']);
    expect(proofIssued).toBe(2);
  });

  it('reads the proof from the csrf body when the header is missing', async () => {
    clearBrowserProof();
    const requests = installFetch((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === CSRF_ENDPOINT) {
        return Response.json({ success: true, data: { token: 'body-session-proof' } });
      }
      return okResponse();
    });
    const store = makeStore();

    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'body@example.com' }))
      .unwrap();

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.proof).toBe('body-session-proof');
  });

  it('ignores a token-shaped body from an endpoint that is not a proof endpoint', async () => {
    clearBrowserProof();
    rememberBrowserProof('session-proof', 'session');
    installFetch(() => Response.json({ success: true, data: { token: 'bogus-token' } }));
    const store = makeStore();

    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'ignore@example.com' }))
      .unwrap();

    expect(currentBrowserProof()).toBe('session-proof');
  });

  it('skips the csrf lookup once a lookup has seen no session', async () => {
    clearBrowserProof();
    let proofIssued = 0;
    const requests = installFetch((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === CSRF_ENDPOINT) {
        return proofError(ErrorCode.CSRF_INVALID);
      }
      if (pathname === BROWSER_PROOF_ENDPOINT) {
        proofIssued += 1;
        return proofResponse(`proof-${proofIssued}`);
      }
      return okResponse();
    });
    const store = makeStore();

    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'first@example.com' }))
      .unwrap();
    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'second@example.com' }))
      .unwrap();

    expect(proofIssued).toBe(2);
    expect(requests.map((request) => request.pathname)).toEqual([
      CSRF_ENDPOINT,
      BROWSER_PROOF_ENDPOINT,
      '/api/auth/forgot-password',
      BROWSER_PROOF_ENDPOINT,
      '/api/auth/forgot-password',
    ]);
  });

  it('asks csrf again when a hinted-signed-out request fails with CSRF_INVALID', async () => {
    clearBrowserProof();
    let proofIssued = 0;
    let postAttempt = 0;
    let serverHasSession = false;
    const requests = installFetch((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === CSRF_ENDPOINT) {
        return serverHasSession
          ? proofResponse('session-proof')
          : proofError(ErrorCode.CSRF_INVALID);
      }
      if (pathname === BROWSER_PROOF_ENDPOINT) {
        proofIssued += 1;
        return proofResponse(`proof-${proofIssued}`);
      }
      postAttempt += 1;
      if (postAttempt === 2) {
        return proofError(ErrorCode.CSRF_INVALID);
      }
      return okResponse();
    });
    const store = makeStore();

    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'warmup@example.com' }))
      .unwrap();
    serverHasSession = true;
    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'target@example.com' }))
      .unwrap();

    expect(proofIssued).toBe(2);
    expect(requests.map((request) => request.pathname)).toEqual([
      CSRF_ENDPOINT,
      BROWSER_PROOF_ENDPOINT,
      '/api/auth/forgot-password',
      BROWSER_PROOF_ENDPOINT,
      '/api/auth/forgot-password',
      CSRF_ENDPOINT,
      '/api/auth/forgot-password',
    ]);
    expect(requests[requests.length - 1]).toMatchObject({
      method: 'POST',
      proof: 'session-proof',
    });
  });

  it('makes no proof request after a response has delivered a session proof', async () => {
    clearBrowserProof();
    let proofIssued = 0;
    let postCount = 0;
    const requests = installFetch((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === CSRF_ENDPOINT) {
        return proofError(ErrorCode.CSRF_INVALID);
      }
      if (pathname === BROWSER_PROOF_ENDPOINT) {
        proofIssued += 1;
        return proofResponse(`proof-${proofIssued}`);
      }
      postCount += 1;
      if (postCount === 1) {
        return Response.json(
          { success: true, data: { message: 'ok' } },
          { headers: { [CSRF_HEADER]: 'session-proof' } },
        );
      }
      return okResponse();
    });
    const store = makeStore();

    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'first@example.com' }))
      .unwrap();
    await store
      .dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'second@example.com' }))
      .unwrap();

    expect(requests.map((request) => request.pathname)).toEqual([
      CSRF_ENDPOINT,
      BROWSER_PROOF_ENDPOINT,
      '/api/auth/forgot-password',
      '/api/auth/forgot-password',
    ]);
    expect(requests[requests.length - 1]).toMatchObject({
      method: 'POST',
      proof: 'session-proof',
    });
  });

  it('does not clear the holder for a url that merely contains the logout path', async () => {
    clearBrowserProof();
    rememberBrowserProof('session-proof', 'session');
    installFetch(() => okResponse());
    const store = makeStore();

    await store.dispatch(logoutLikeApi.endpoints.touchLogoutPath.initiate()).unwrap();

    expect(currentBrowserProof()).toBe('session-proof');
  });
});
