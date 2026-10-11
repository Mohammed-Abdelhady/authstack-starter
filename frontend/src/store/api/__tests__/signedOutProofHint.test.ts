import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_PROOF_ENDPOINT, CSRF_ENDPOINT } from '@/constants/api';
import { ErrorCode } from '@app/core';
import { authApi } from '@/modules/auth/store/authApi';
import { CSRF_HEADER, clearBrowserProof } from '../browser-proof';

const PROFILE_PATH = '/api/user/profile';
const WRITE_PATH = '/api/auth/forgot-password';

const PROFILE = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};

function refused(status: number, code: string): Response {
  return Response.json({ success: false, error: { code, message: 'refused' } }, { status });
}

function proof(token: string): Response {
  return Response.json({ success: true, data: { token } }, { headers: { [CSRF_HEADER]: token } });
}

/** Answers the session read with `profile` and records every path asked for, in order. */
function installServer(profile: () => Response): string[] {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const { pathname } = new URL(request.url);
    paths.push(`${request.method} ${pathname}`);
    if (pathname === PROFILE_PATH) return profile();
    if (pathname === CSRF_ENDPOINT) return refused(403, ErrorCode.CSRF_INVALID);
    if (pathname === BROWSER_PROOF_ENDPOINT) return proof('pre-session-proof');
    return Response.json({ success: true, data: { message: 'ok' } });
  });
  return paths;
}

function makeStore() {
  return configureStore({
    reducer: { [authApi.reducerPath]: authApi.reducer },
    middleware: (defaults) => defaults().concat(authApi.middleware),
  });
}

/** The page asks who is signed in, then the person sends a write. */
async function readSessionThenWrite(profile: () => Response): Promise<string[]> {
  const paths = installServer(profile);
  const store = makeStore();
  await store.dispatch(authApi.endpoints.getCurrentUser.initiate());
  await store.dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'layla@example.com' }));
  return paths;
}

afterEach(() => {
  clearBrowserProof();
  vi.unstubAllGlobals();
});

describe('proof lookup after the session read', () => {
  it('skips the csrf lookup when the session read said nobody is signed in', async () => {
    expect(await readSessionThenWrite(() => refused(401, 'SESSION_INVALID'))).toEqual([
      `GET ${PROFILE_PATH}`,
      `GET ${BROWSER_PROOF_ENDPOINT}`,
      `POST ${WRITE_PATH}`,
    ]);
  });

  it.each([
    ['answered with a profile', () => Response.json({ success: true, data: PROFILE })],
    ['was forbidden', () => refused(403, 'FORBIDDEN')],
    ['failed on the server', () => refused(500, 'INTERNAL_ERROR')],
  ])('still asks csrf first when the session read %s', async (_label, profile) => {
    expect(await readSessionThenWrite(profile)).toEqual([
      `GET ${PROFILE_PATH}`,
      `GET ${CSRF_ENDPOINT}`,
      `GET ${BROWSER_PROOF_ENDPOINT}`,
      `POST ${WRITE_PATH}`,
    ]);
  });
});
