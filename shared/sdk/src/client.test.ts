import { describe, expect, it } from 'vitest';
import { createApiClient } from './client';
import { answering } from './test-support';

const PROFILE = {
  id: '507f1f77bcf86cd799439011',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: ['profile:read:own'],
  authProvider: 'email',
  isVerified: true,
  linkedProviders: ['email'],
  createdAt: '2026-01-15T10:30:00.000Z',
  updatedAt: '2026-01-16T08:00:00.000Z',
};

const IDENTITY_PROFILE = {
  ...PROFILE,
  // feature:totp:start
  twoFactorEnabled: false,
  // feature:totp:end
  // feature:passkeys:start
  passkeyCount: 0,
  // feature:passkeys:end
};

const TOKEN_BODY = {
  access_token: 'at-1',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'rt-1',
  scope: 'api',
};

const TOKEN_SET = {
  accessToken: 'at-1',
  tokenType: 'Bearer',
  expiresIn: 900,
  refreshToken: 'rt-1',
  scope: 'api',
};

describe('createApiClient routes', () => {
  it('reads a signed-out identity without requesting the protected profile', async () => {
    const transport = answering(200, {
      success: true,
      data: { authenticated: false, user: null },
    });

    expect(await createApiClient(transport).auth.identity()).toEqual({
      authenticated: false,
      user: null,
    });
    expect(transport.sent).toStrictEqual([{ method: 'GET', path: '/api/auth/identity' }]);
  });

  it('reads an authenticated identity', async () => {
    const transport = answering(200, {
      success: true,
      data: { authenticated: true, user: IDENTITY_PROFILE },
    });

    expect(await createApiClient(transport).auth.identity()).toEqual({
      authenticated: true,
      user: IDENTITY_PROFILE,
    });
  });

  it('reads the profile', async () => {
    const transport = answering(200, { success: true, data: PROFILE });

    const user = await createApiClient(transport).profile.get();

    expect(transport.sent).toStrictEqual([{ method: 'GET', path: '/api/user/profile' }]);
    expect(user).toEqual({
      id: '507f1f77bcf86cd799439011',
      email: 'layla@example.com',
      name: 'Layla Haddad',
      role: 'user',
      permissions: ['profile:read:own'],
      authProvider: 'email',
      isVerified: true,
      linkedProviders: ['email'],
      createdAt: '2026-01-15T10:30:00.000Z',
      updatedAt: '2026-01-16T08:00:00.000Z',
    });
  });

  it('updates the profile name', async () => {
    const transport = answering(200, {
      success: true,
      data: { ...PROFILE, name: 'Layla H.' },
      message: 'Profile updated successfully',
    });

    const user = await createApiClient(transport).profile.update({ name: 'Layla H.' });

    expect(transport.sent).toStrictEqual([
      { method: 'PATCH', path: '/api/user/profile', body: { name: 'Layla H.' } },
    ]);
    expect(user.name).toBe('Layla H.');
  });

  it('lists the sessions', async () => {
    const session = {
      id: '65a000000000000000000001',
      userAgent: 'Mozilla/5.0',
      ip: '203.0.113.10',
      deviceName: 'Chrome on macOS',
      createdAt: '2026-01-15T10:30:00.000Z',
      lastUsedAt: '2026-01-15T11:30:00.000Z',
      isCurrent: true,
    };
    const transport = answering(200, { success: true, data: { sessions: [session], total: 1 } });

    const list = await createApiClient(transport).sessions.list();

    expect(transport.sent).toStrictEqual([{ method: 'GET', path: '/api/user/sessions' }]);
    expect(list).toEqual({
      sessions: [
        {
          id: '65a000000000000000000001',
          userAgent: 'Mozilla/5.0',
          ip: '203.0.113.10',
          deviceName: 'Chrome on macOS',
          createdAt: '2026-01-15T10:30:00.000Z',
          lastUsedAt: '2026-01-15T11:30:00.000Z',
          isCurrent: true,
        },
      ],
      total: 1,
    });
  });

  it('revokes one session by id', async () => {
    const transport = answering(200, {
      success: true,
      data: { message: 'Session revoked successfully' },
    });

    const result = await createApiClient(transport).sessions.revoke('65a000000000000000000001');

    expect(transport.sent).toStrictEqual([
      { method: 'DELETE', path: '/api/user/sessions/65a000000000000000000001' },
    ]);
    expect(result).toEqual({ message: 'Session revoked successfully' });
  });

  it.each(['', '.', '..'])('rejects the session id %j without sending anything', async (id) => {
    const transport = answering(200, { success: true, data: { message: 'ok' } });

    await expect(createApiClient(transport).sessions.revoke(id)).rejects.toBeInstanceOf(TypeError);
    expect(transport.sent).toEqual([]);
  });

  it('revokes the other sessions', async () => {
    const transport = answering(200, { success: true, data: { revokedCount: 3 } });

    const result = await createApiClient(transport).sessions.revokeOthers();

    expect(transport.sent).toStrictEqual([
      { method: 'POST', path: '/api/user/sessions/revoke-others' },
    ]);
    expect(result).toEqual({ revokedCount: 3 });
  });

  it('reads the sign-in methods and fills in what the server left out', async () => {
    const transport = answering(200, {
      success: true,
      data: { methods: { password: true, passkeys: true, oauth: [{ id: 'x', displayName: 'X' }] } },
    });

    const methods = await createApiClient(transport).auth.methods();

    expect(transport.sent).toStrictEqual([{ method: 'GET', path: '/api/auth/methods' }]);
    expect(methods).toEqual({
      password: true,
      magicLink: false,
      twoFactor: false,
      passkeys: true,
      oauth: [{ id: 'x', displayName: 'X' }],
    });
  });

  it('signs out', async () => {
    const transport = answering(200, { success: true, data: { message: 'Logout successful' } });

    const result = await createApiClient(transport).auth.signOut();

    expect(transport.sent).toStrictEqual([{ method: 'POST', path: '/api/auth/logout' }]);
    expect(result).toEqual({ message: 'Logout successful' });
  });

  it('exchanges an authorization code in the wire naming', async () => {
    const transport = answering(200, TOKEN_BODY);

    const tokens = await createApiClient(transport).oauth.exchangeCode({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'myapp://callback',
      clientId: 'native-app',
    });

    expect(transport.sent).toStrictEqual([
      {
        method: 'POST',
        path: '/api/oauth/token',
        body: {
          grant_type: 'authorization_code',
          code: 'code-1',
          redirect_uri: 'myapp://callback',
          client_id: 'native-app',
          code_verifier: 'verifier-1',
        },
      },
    ]);
    expect(tokens).toEqual(TOKEN_SET);
  });

  it('forwards DPoP headers on each OAuth call', async () => {
    const transport = answering(200, TOKEN_BODY);
    const client = createApiClient(transport);
    const options = { headers: { DPoP: 'proof-jwt' } };

    await client.oauth.exchangeCode(
      {
        code: 'code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'myapp://callback',
        clientId: 'native-app',
      },
      options,
    );
    await client.oauth.refresh({ refreshToken: 'rt-0', clientId: 'native-app' }, options);
    await client.oauth.revoke({ token: 'rt-1', clientId: 'native-app' }, options);

    expect(transport.sent.map(({ headers }) => headers?.DPoP)).toEqual([
      'proof-jwt',
      'proof-jwt',
      'proof-jwt',
    ]);
  });

  it('refreshes in the wire naming', async () => {
    const transport = answering(200, TOKEN_BODY);

    const tokens = await createApiClient(transport).oauth.refresh({
      refreshToken: 'rt-0',
      clientId: 'native-app',
    });

    expect(transport.sent).toStrictEqual([
      {
        method: 'POST',
        path: '/api/oauth/token',
        body: { grant_type: 'refresh_token', refresh_token: 'rt-0', client_id: 'native-app' },
      },
    ]);
    expect(tokens).toEqual(TOKEN_SET);
  });

  it('revokes a token and resolves with nothing', async () => {
    const transport = answering(200, {});

    const result = await createApiClient(transport).oauth.revoke({
      token: 'rt-1',
      clientId: 'native-app',
    });

    expect(transport.sent).toStrictEqual([
      {
        method: 'POST',
        path: '/api/oauth/revoke',
        body: { token: 'rt-1', client_id: 'native-app' },
      },
    ]);
    expect(result).toBeUndefined();
  });

  it('leaves client_id out of a revoke that names no client', async () => {
    const transport = answering(200, {});

    await createApiClient(transport).oauth.revoke({ token: 'rt-1' });

    expect(transport.sent[0].body).toStrictEqual({ token: 'rt-1' });
  });
});
