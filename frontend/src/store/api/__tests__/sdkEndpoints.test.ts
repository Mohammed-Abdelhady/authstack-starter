import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authMethodsApi } from '@/modules/auth/api/authMethodsApi';
import { authApi } from '@/modules/auth/store/authApi';
import { sessionsApi } from '@/modules/sessions/api/sessionsApi';
import { baseApi } from '../baseApi';
import { clearBrowserProof, rememberBrowserProof } from '../browser-proof';

interface RecordedRequest {
  method: string;
  pathname: string;
  body: string;
}

/** Answers every request with one hand-written body and records what was sent. */
function installFetch(body: unknown): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push({
      method: request.method,
      pathname: new URL(request.url).pathname,
      body: await request.clone().text(),
    });
    return Response.json(body);
  });
  return requests;
}

function makeStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (defaults) => defaults().concat(baseApi.middleware),
  });
}

const SESSION = {
  id: '65a000000000000000000001',
  userAgent: 'Mozilla/5.0',
  ip: '203.0.113.10',
  createdAt: '2026-01-15T10:30:00.000Z',
  isCurrent: true,
  credentialPurpose: 'browser_session',
};

const PROFILE = {
  id: '507f1f77bcf86cd799439011',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  linkedProviders: ['email'],
};

beforeEach(() => {
  // A held session proof keeps the unsafe requests from fetching one first.
  rememberBrowserProof('session-proof', 'session');
});

afterEach(() => {
  clearBrowserProof();
  vi.unstubAllGlobals();
});

describe('endpoints that read through @app/sdk', () => {
  it('lists the sessions out of the envelope', async () => {
    const requests = installFetch({ success: true, data: { sessions: [SESSION], total: 1 } });

    const sessions = await makeStore().dispatch(sessionsApi.endpoints.getSessions.initiate());

    expect(requests).toEqual([{ method: 'GET', pathname: '/api/user/sessions', body: '' }]);
    expect(sessions.data).toEqual([
      {
        id: '65a000000000000000000001',
        userAgent: 'Mozilla/5.0',
        ip: '203.0.113.10',
        createdAt: '2026-01-15T10:30:00.000Z',
        isCurrent: true,
        credentialPurpose: 'browser_session',
      },
    ]);
  });

  it('rejects a reply that carries data but is not a success envelope', async () => {
    installFetch({ data: { sessions: [SESSION] } });

    const sessions = await makeStore().dispatch(sessionsApi.endpoints.getSessions.initiate());

    expect(sessions.isError).toBe(true);
    expect(sessions.data).toBeUndefined();
    expect(sessions.error).toMatchObject({ name: 'ApiError' });
  });

  it.each([
    ['null data', { success: true, data: null }],
    ['data without a list of sessions', { success: true, data: { sessions: null } }],
  ])('rejects a sessions reply with %s as an ApiError', async (_label, body) => {
    installFetch(body);

    const sessions = await makeStore().dispatch(sessionsApi.endpoints.getSessions.initiate());

    expect(sessions.isError).toBe(true);
    expect(sessions.error).toMatchObject({ name: 'ApiError' });
  });

  it.each(['', '.', '..'])('sends nothing for the session id %j', async (sessionId) => {
    const requests = installFetch({ success: true, data: { message: 'revoked' } });

    const result = await makeStore().dispatch(
      sessionsApi.endpoints.deleteSession.initiate(sessionId),
    );

    expect('error' in result).toBe(true);
    expect(requests).toEqual([]);
  });

  it('revokes one session by id', async () => {
    const requests = installFetch({ success: true, data: { message: 'revoked' } });

    const result = await makeStore()
      .dispatch(sessionsApi.endpoints.deleteSession.initiate('65a000000000000000000002'))
      .unwrap();

    expect(requests).toEqual([
      { method: 'DELETE', pathname: '/api/user/sessions/65a000000000000000000002', body: '' },
    ]);
    expect(result).toEqual({ message: 'revoked' });
  });

  it('revokes the other sessions', async () => {
    const requests = installFetch({ success: true, data: { revokedCount: 2 } });

    const result = await makeStore()
      .dispatch(sessionsApi.endpoints.revokeAllOtherSessions.initiate())
      .unwrap();

    expect(requests).toEqual([
      { method: 'POST', pathname: '/api/user/sessions/revoke-others', body: '' },
    ]);
    expect(result).toEqual({ revokedCount: 2 });
  });

  it('reads a sign-in method the server left out as off', async () => {
    const requests = installFetch({
      success: true,
      data: { methods: { password: true, passkeys: true } },
    });

    const methods = await makeStore().dispatch(authMethodsApi.endpoints.getAuthMethods.initiate());

    expect(requests).toEqual([{ method: 'GET', pathname: '/api/auth/methods', body: '' }]);
    expect(methods.data).toEqual({
      password: true,
      magicLink: false,
      emailCode: false,
      twoFactor: false,
      passkeys: true,
      oauth: [],
    });
  });

  it.each([
    ['null data', { success: true, data: null }],
    ['data without methods', { success: true, data: {} }],
    ['methods without the password switch', { success: true, data: { methods: {} } }],
  ])('rejects a methods reply with %s instead of reporting every method off', async (_l, body) => {
    installFetch(body);

    const methods = await makeStore().dispatch(authMethodsApi.endpoints.getAuthMethods.initiate());

    expect(methods.isError).toBe(true);
    expect(methods.data).toBeUndefined();
    expect(methods.error).toMatchObject({ name: 'ApiError' });
  });

  it('reads the current account out of the envelope', async () => {
    const requests = installFetch({ success: true, data: PROFILE });

    const user = await makeStore().dispatch(authApi.endpoints.getCurrentUser.initiate());

    expect(requests).toEqual([{ method: 'GET', pathname: '/api/user/profile', body: '' }]);
    expect(user.data).toEqual({
      id: '507f1f77bcf86cd799439011',
      email: 'layla@example.com',
      name: 'Layla Haddad',
      role: 'user',
      permissions: [],
      authProvider: 'email',
      isVerified: true,
      linkedProviders: ['email'],
    });
  });

  it('rejects a profile reply whose data is null', async () => {
    installFetch({ success: true, data: null });

    const user = await makeStore().dispatch(authApi.endpoints.getCurrentUser.initiate());

    expect(user.isError).toBe(true);
    expect(user.data).toBeUndefined();
  });

  it('updates the profile and returns the account', async () => {
    const requests = installFetch({
      success: true,
      data: { ...PROFILE, name: 'Layla H.' },
      message: 'Profile updated successfully',
    });

    const user = await makeStore()
      .dispatch(authApi.endpoints.updateProfile.initiate({ name: 'Layla H.' }))
      .unwrap();

    expect(requests).toEqual([
      { method: 'PATCH', pathname: '/api/user/profile', body: '{"name":"Layla H."}' },
    ]);
    expect(user.name).toBe('Layla H.');
    expect(user.email).toBe('layla@example.com');
  });

  it('signs out and returns the confirmation, not the envelope', async () => {
    const requests = installFetch({ success: true, data: { message: 'signed out' } });

    const result = await makeStore().dispatch(authApi.endpoints.logout.initiate()).unwrap();

    expect(requests).toEqual([{ method: 'POST', pathname: '/api/auth/logout', body: '' }]);
    expect(result).toEqual({ message: 'signed out' });
  });
});
