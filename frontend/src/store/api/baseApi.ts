import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import {
  API_BASE_URL,
  BROWSER_PROOF_ENDPOINT,
  CSRF_ENDPOINT,
  LOGOUT_ENDPOINT,
} from '@/constants/api';
import { HTTP_STATUS } from '@/constants/httpStatus';
import { ErrorCode, getErrorCode } from '@app/core';
import { API_PATHS, unwrapIdentityBody } from '@app/sdk';
import {
  CSRF_HEADER,
  clearBrowserProof,
  csrfLookupHint,
  methodNeedsBrowserProof,
  rememberBrowserProof,
  rememberNoSession,
  rememberSessionPresent,
  takeBrowserProof,
  type BrowserProofKind,
} from './browser-proof';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  credentials: 'include',
  prepareHeaders: (headers) => {
    headers.set('Content-Type', 'application/json');
    return headers;
  },
});

type RawQueryApi = Parameters<typeof rawBaseQuery>[1];
type RawQueryExtra = Parameters<typeof rawBaseQuery>[2];

function requestUrl(args: string | FetchArgs): string {
  return typeof args === 'string' ? args : args.url;
}

function requestMethod(args: string | FetchArgs): string | undefined {
  return typeof args === 'string' ? undefined : args.method;
}

type RequestHeaders = FetchArgs['headers'];

function mergeHeaders(init: RequestHeaders): Headers {
  const headers = new Headers();
  if (!init) {
    return headers;
  }
  if (init instanceof Headers) {
    init.forEach((value, key) => headers.set(key, value));
    return headers;
  }
  if (Array.isArray(init)) {
    for (const [key, value] of init) {
      headers.set(key, value);
    }
    return headers;
  }
  for (const [key, value] of Object.entries(init)) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

function withBrowserProof(args: string | FetchArgs, proof: string): string | FetchArgs {
  if (typeof args === 'string') {
    return { url: args, headers: { [CSRF_HEADER]: proof } };
  }
  const headers = mergeHeaders(args.headers);
  headers.set(CSRF_HEADER, proof);
  return { ...args, headers };
}

/**
 * Only the two proof endpoints return the token in the body; a body shaped
 * like `{ data: { token } }` from any other endpoint must be ignored.
 */
function proofTokenFromBody(data: unknown, url: string): string | undefined {
  if (url !== CSRF_ENDPOINT && url !== BROWSER_PROOF_ENDPOINT) {
    return undefined;
  }
  if (data === null || typeof data !== 'object' || !('data' in data)) {
    return undefined;
  }
  const body = data.data;
  if (body === null || typeof body !== 'object' || !('token' in body)) {
    return undefined;
  }
  const token = body.token;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

function issuedToken(
  response: Response | undefined,
  data: unknown,
  url: string,
): string | undefined {
  const header = response?.headers.get(CSRF_HEADER);
  if (header) {
    return header;
  }
  return proofTokenFromBody(data, url);
}

function proofKindForUrl(url: string): BrowserProofKind {
  return url === BROWSER_PROOF_ENDPOINT ? 'pre-session' : 'session';
}

function rememberIssuedProof(response: Response | undefined, data: unknown, url: string): void {
  const token = issuedToken(response, data, url);
  if (token) {
    rememberBrowserProof(token, proofKindForUrl(url));
  }
}

type IdentityProofFence =
  | { kind: 'legacy' }
  | { kind: 'inactive' }
  | { kind: 'request'; requestId: string; sessionGeneration: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function identityProofFence(state: unknown): IdentityProofFence {
  if (!isRecord(state) || !('auth' in state) || !isRecord(state.auth)) {
    return { kind: 'legacy' };
  }

  const auth = state.auth;
  if (
    !('sessionGeneration' in auth) ||
    !('identityRequest' in auth) ||
    typeof auth.sessionGeneration !== 'number'
  ) {
    return { kind: 'legacy' };
  }

  if (!isRecord(auth.identityRequest)) {
    return { kind: 'inactive' };
  }

  const { requestId, sessionGeneration } = auth.identityRequest;
  if (
    typeof requestId !== 'string' ||
    requestId.length === 0 ||
    typeof sessionGeneration !== 'number' ||
    sessionGeneration !== auth.sessionGeneration
  ) {
    return { kind: 'inactive' };
  }

  return { kind: 'request', requestId, sessionGeneration };
}

function identityProofFenceIsCurrent(state: unknown, started: IdentityProofFence): boolean {
  const current = identityProofFence(state);
  if (started.kind === 'legacy') {
    return current.kind === 'legacy';
  }
  return (
    started.kind === 'request' &&
    current.kind === 'request' &&
    started.requestId === current.requestId &&
    started.sessionGeneration === current.sessionGeneration
  );
}

function updateIdentityProofHint(result: Awaited<ReturnType<typeof rawBaseQuery>>): void {
  try {
    const identity = unwrapIdentityBody(result.data);
    if (!identity.authenticated) {
      clearBrowserProof();
      rememberNoSession();
    } else {
      rememberSessionPresent();
    }
  } catch {
    clearBrowserProof();
  }
}

/**
 * Reads the session proof first (for a reloaded signed-in page) and falls back
 * to a fresh pre-session proof when there is no session. A pre-session proof
 * is stored and consumed inside this function, so no other request can take a
 * single-use proof that is already claimed.
 */
type ProofResult = { proof: string; error?: never } | { proof?: never; error: FetchBaseQueryError };

function missingProof(): ProofResult {
  return { error: { status: 'CUSTOM_ERROR', error: 'Browser proof was not issued' } };
}

async function loadBrowserProof(api: RawQueryApi, extra: RawQueryExtra): Promise<ProofResult> {
  if (csrfLookupHint() !== 'no-session') {
    const session = await rawBaseQuery({ url: CSRF_ENDPOINT }, api, extra);
    if (session.error) {
      const hasNoSession =
        session.error.status === HTTP_STATUS.UNAUTHORIZED ||
        getErrorCode(session.error) === ErrorCode.CSRF_INVALID;
      if (!hasNoSession) return { error: session.error };
      rememberNoSession();
    } else {
      const sessionToken = issuedToken(session.meta?.response, session.data, CSRF_ENDPOINT);
      if (sessionToken) {
        rememberBrowserProof(sessionToken, 'session');
        return { proof: sessionToken };
      }
      return missingProof();
    }
  }

  const preSession = await rawBaseQuery({ url: BROWSER_PROOF_ENDPOINT }, api, extra);
  if (preSession.error) return { error: preSession.error };
  const preSessionToken = issuedToken(
    preSession.meta?.response,
    preSession.data,
    BROWSER_PROOF_ENDPOINT,
  );
  if (!preSessionToken) {
    return missingProof();
  }
  rememberBrowserProof(preSessionToken, 'pre-session');
  return { proof: takeBrowserProof() };
}

function isProofFailure(error: FetchBaseQueryError | undefined): boolean {
  if (!error) {
    return false;
  }
  const code = getErrorCode(error);
  return code === ErrorCode.CSRF_INVALID || code === ErrorCode.CSRF_REQUIRED;
}

const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extra,
) => {
  const url = requestUrl(args);
  const unsafe = methodNeedsBrowserProof(requestMethod(args));
  const identityFence =
    url === API_PATHS.auth.identity ? identityProofFence(api.getState()) : undefined;

  let proof = unsafe ? takeBrowserProof() : '';
  if (unsafe && !proof) {
    const loaded = await loadBrowserProof(api, extra);
    if (loaded.error) return { error: loaded.error };
    proof = loaded.proof;
  }

  let result = await rawBaseQuery(proof ? withBrowserProof(args, proof) : args, api, extra);
  if (identityFence) {
    if (identityProofFenceIsCurrent(api.getState(), identityFence)) {
      rememberIssuedProof(result.meta?.response, result.data, url);
      updateIdentityProofHint(result);
    }
  } else {
    rememberIssuedProof(result.meta?.response, result.data, url);
  }

  // A spent or stale proof must be replaced and the request retried exactly
  // once. The retry reuses `rawBaseQuery`, so it can never itself retry.
  if (unsafe && isProofFailure(result.error)) {
    clearBrowserProof();
    const retryProof = await loadBrowserProof(api, extra);
    if (retryProof.error) return { error: retryProof.error };
    result = await rawBaseQuery(withBrowserProof(args, retryProof.proof), api, extra);
    rememberIssuedProof(result.meta?.response, result.data, url);
  }

  if (url === LOGOUT_ENDPOINT) {
    clearBrowserProof();
  }
  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: [
    'User',
    'Auth',
    'AuthMethods',
    'LinkedProviders', // feature:oauth-core
    'ProfileSync', // feature:oauth-core
    'Roles',
    'Permissions',
    'Sessions',
    'Passkeys', // feature:passkeys
  ],
  endpoints: () => ({}),
});
