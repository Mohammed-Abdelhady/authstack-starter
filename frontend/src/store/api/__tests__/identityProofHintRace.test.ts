// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@app/core';
import { BROWSER_PROOF_ENDPOINT, CSRF_ENDPOINT } from '@app/sdk';
import { HTTP_STATUS } from '@/constants/httpStatus';
import { authApi } from '@/modules/auth/store/authApi';
import {
  makeStore,
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { CSRF_HEADER } from '../browser-proof';

const IDENTITY_PATH = '/api/auth/identity';
const LOGIN_PATH = '/api/auth/login';
const CHANGE_PASSWORD_PATH = '/api/user/password';
const SESSION_PROOF = 'confirmed-session-proof';

const PROFILE = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: ['profile:read'],
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false,
  passkeyCount: 0,
  linkedProviders: ['email'],
  locale: 'en',
};

interface CapturedRequest {
  method: string;
  path: string;
  proof: string | null;
}

const OBSOLETE_IDENTITY_REPLIES = [
  {
    name: 'signed-in',
    respond: () => success({ authenticated: true, user: { ...PROFILE, id: 'obsolete-user' } }),
  },
  {
    name: 'signed-out',
    respond: () => success({ authenticated: false, user: null }),
  },
  {
    name: 'malformed with an old proof header',
    respond: () =>
      Response.json(
        { success: true, data: { authenticated: 'false', user: null } },
        { headers: { [CSRF_HEADER]: 'obsolete-session-proof' } },
      ),
  },
  {
    name: 'rejected',
    respond: () => refusalWith(503, ErrorCode.AUTHORITY_UNAVAILABLE),
  },
] as const;

const lifecycle = registerFormTestLifecycle();

describe.each(OBSOLETE_IDENTITY_REPLIES)(
  'session proof after an obsolete $name identity reply',
  ({ name, respond }) => {
    it('uses the confirmed login proof directly for the next protected write', async () => {
      if (name === 'malformed with an old proof header') {
        lifecycle.expectConsoleError(
          /unhandled error occurred processing a request for the endpoint "getIdentity"/i,
        );
      }
      const calls: CapturedRequest[] = [];
      let identityCount = 0;
      let releaseFirstIdentity: ((response: Response) => void) | undefined;
      let signalIdentityStarted: (() => void) | undefined;
      const identityStarted = new Promise<void>((resolve) => {
        signalIdentityStarted = resolve;
      });
      const requests = stubNetwork(
        (request, path) => {
          calls.push({
            method: request.method,
            path,
            proof: request.headers.get(CSRF_HEADER),
          });

          if (path === IDENTITY_PATH) {
            identityCount += 1;
            if (identityCount === 1) {
              signalIdentityStarted?.();
              return new Promise<Response>((resolve) => {
                releaseFirstIdentity = resolve;
              });
            }
            return success({ authenticated: true, user: PROFILE });
          }
          if (path === CSRF_ENDPOINT) {
            return refusalWith(HTTP_STATUS.UNAUTHORIZED, ErrorCode.SESSION_REQUIRED);
          }
          if (path === BROWSER_PROOF_ENDPOINT) {
            return Response.json(
              { success: true, data: { token: 'anonymous-proof' } },
              { headers: { [CSRF_HEADER]: 'anonymous-proof' } },
            );
          }
          if (path === LOGIN_PATH) {
            return Response.json(
              {
                success: true,
                data: { requiresTwoFactor: false, user: PROFILE },
                message: 'signed in',
              },
              { headers: { [CSRF_HEADER]: SESSION_PROOF } },
            );
          }
          if (path === CHANGE_PASSWORD_PATH) {
            return request.headers.get(CSRF_HEADER) === SESSION_PROOF
              ? success({ message: 'updated' })
              : refusalWith(403, ErrorCode.CSRF_INVALID);
          }
          return success({});
        },
        { proof: 'delegate' },
      );
      const store = makeStore();

      const identityRead = store.dispatch(
        authApi.endpoints.getIdentity.initiate(undefined, { forceRefetch: true }),
      );
      await identityStarted;
      await store
        .dispatch(authApi.endpoints.login.initiate({ email: PROFILE.email, password: 'correct' }))
        .unwrap();
      expect(store.getState().auth).toMatchObject({
        user: { id: PROFILE.id },
        isAuthenticated: true,
        validationStatus: 'succeeded',
      });

      const loginCallIndex = calls.findIndex((call) => call.path === LOGIN_PATH);
      releaseFirstIdentity?.(respond());
      await identityRead;
      await Promise.all(store.dispatch(authApi.util.getRunningQueriesThunk()));
      const writeResult = await store.dispatch(
        authApi.endpoints.changePassword.initiate({
          currentPassword: 'correct',
          newPassword: 'ChangedPass123',
        }),
      );

      expect(writeResult.error).toBeUndefined();
      expect(store.getState().auth).toMatchObject({
        user: { id: PROFILE.id },
        isAuthenticated: true,
      });
      expect(calls.slice(loginCallIndex + 1).some((call) => call.path === CSRF_ENDPOINT)).toBe(
        false,
      );
      expect(
        calls.slice(loginCallIndex + 1).some((call) => call.path === BROWSER_PROOF_ENDPOINT),
      ).toBe(false);
      const writes = calls.filter((call) => call.path === CHANGE_PASSWORD_PATH);
      expect(writes).toEqual([
        { method: 'POST', path: CHANGE_PASSWORD_PATH, proof: SESSION_PROOF },
      ]);
      expect(requests.allRequests).toContain(`GET ${IDENTITY_PATH}`);
    });
  },
);
