import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';
import { ApiError } from '../errors';

const ROLE = {
  id: 'role-1',
  name: 'Support',
  slug: 'support',
  isSystemRole: false,
  isProtected: false,
  level: 2,
  permissions: ['users:read:all'],
  createdAt: '2026-10-15T09:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

describe('admin roles', () => {
  it('h24 preserves optional creation level and every role field', async () => {
    const transport = answering(201, { success: true, data: ROLE });
    const { roles } = createApiClient(transport).admin;
    const result = await roles.create(
      { name: 'Support', permissions: ['users:read:all'], description: 'Help', level: 2 },
      { operation: { operationKey: 'role-create-1' } },
    );
    await roles.create(
      { name: 'Support', permissions: ['users:read:all'] },
      { operation: { operationKey: 'role-create-2' } },
    );

    expect(result).toStrictEqual({
      id: 'role-1',
      name: 'Support',
      slug: 'support',
      isSystemRole: false,
      isProtected: false,
      level: 2,
      permissions: ['users:read:all'],
      createdAt: '2026-10-15T09:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
    });
    expect(transport.sent).toStrictEqual([
      {
        method: 'POST',
        path: '/api/roles',
        body: { name: 'Support', permissions: ['users:read:all'], description: 'Help', level: 2 },
        operationKey: 'role-create-1',
      },
      {
        method: 'POST',
        path: '/api/roles',
        body: { name: 'Support', permissions: ['users:read:all'] },
        operationKey: 'role-create-2',
      },
    ]);
  });

  it('h24 keeps omitted edit level omitted and preserves usersMoved', async () => {
    const transport = answering(200, { success: true, data: { ...ROLE, usersMoved: 4 } });
    const { roles } = createApiClient(transport).admin;
    const result = await roles.update('support', { name: 'Help desk', description: '' });
    await roles.update('role-1', { permissions: ['users:list:all'], level: 3 });

    expect(result.usersMoved).toBe(4);
    expect(result.level).toBe(2);
    expect(transport.sent).toStrictEqual([
      {
        method: 'PATCH',
        path: '/api/roles/support',
        body: { name: 'Help desk', description: '' },
      },
      {
        method: 'PATCH',
        path: '/api/roles/role-1',
        body: { permissions: ['users:list:all'], level: 3 },
      },
    ]);
  });

  it('h24 sends role pagination and reads its distinct page shape', async () => {
    const transport = answering(200, {
      success: true,
      data: { roles: [ROLE], total: 3, page: 2, pages: 3 },
    });
    const { roles } = createApiClient(transport).admin;
    const result = await roles.list({ page: 2, limit: 1, search: 'support & desk' });

    expect(result.page).toBe(2);
    expect(result.pages).toBe(3);
    expect(result.total).toBe(3);
    expect(result.roles[0]?.slug).toBe('support');
    expect(transport.sent).toStrictEqual([
      { method: 'GET', path: '/api/roles?page=2&limit=1&search=support%20%26%20desk' },
    ]);
  });

  it('h24 fetches a role by encoded id or slug', async () => {
    const transport = answering(200, { success: true, data: ROLE });
    expect((await createApiClient(transport).admin.roles.get('help/desk')).id).toBe('role-1');
    expect(transport.sent).toStrictEqual([{ method: 'GET', path: '/api/roles/help%2Fdesk' }]);
  });
});

describe('admin sessions', () => {
  it.each([null, {}, undefined])('h25 refuses a malformed session list %j', async (sessions) => {
    const transport = answering(200, {
      success: true,
      data: { targetClass: 'staff', total: 1, sessions },
    });

    await expect(
      createApiClient(transport).admin.sessions.list('account-1'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(transport.sent).toStrictEqual([
      { method: 'GET', path: '/api/admin/users/account-1/sessions' },
    ]);
  });

  it('h25 keeps customer and staff classes with session application and credential details', async () => {
    for (const targetClass of ['customer', 'staff'] as const) {
      const transport = answering(200, {
        success: true,
        data: {
          targetClass,
          total: 1,
          sessions: [
            {
              id: 'session-1',
              clientId: 'mobile-app',
              userAgent: 'Native client',
              ip: '192.0.2.1',
              deviceName: 'phone',
              deviceParts: { kind: 'mobileApp' },
              createdAt: '2026-10-15T09:00:00.000Z',
              lastUsedAt: '2026-10-15T10:00:00.000Z',
              isCurrent: false,
              credentialPurpose: 'native_access',
            },
          ],
        },
      });
      const result = await createApiClient(transport).admin.sessions.list('target/account');

      expect(result.targetClass).toBe(targetClass);
      expect(result.total).toBe(1);
      expect(result.sessions).toStrictEqual([
        {
          id: 'session-1',
          clientId: 'mobile-app',
          userAgent: 'Native client',
          ip: '192.0.2.1',
          deviceName: 'phone',
          deviceParts: { kind: 'mobileApp' },
          createdAt: '2026-10-15T09:00:00.000Z',
          lastUsedAt: '2026-10-15T10:00:00.000Z',
          isCurrent: false,
          credentialPurpose: 'native_access',
        },
      ]);
      expect(transport.sent).toStrictEqual([
        { method: 'GET', path: '/api/admin/users/target%2Faccount/sessions' },
      ]);
    }
  });

  it('h25 revokes the targeted session and preserves revoke results', async () => {
    const singleTransport = answering(200, { success: true, data: { revoked: true } });
    const allTransport = answering(200, { success: true, data: { revokedCount: 7 } });
    const single = await createApiClient(singleTransport).admin.sessions.revoke(
      'target/account',
      'session?#1',
    );
    const all = await createApiClient(allTransport).admin.sessions.revokeAll('target/account');

    expect(single).toStrictEqual({ revoked: true });
    expect(all).toStrictEqual({ revokedCount: 7 });
    expect(singleTransport.sent).toStrictEqual([
      { method: 'DELETE', path: '/api/admin/users/target%2Faccount/sessions/session%3F%231' },
    ]);
    expect(allTransport.sent).toStrictEqual([
      { method: 'POST', path: '/api/admin/users/target%2Faccount/sessions/revoke-all' },
    ]);
  });
});
