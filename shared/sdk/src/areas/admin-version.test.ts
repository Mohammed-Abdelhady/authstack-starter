import { ErrorCode } from '@app/core';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering, respond } from '../test-support';

const ACCOUNT = {
  id: 'target',
  version: 7,
  lastActiveAt: null,
  email: 'member@example.com',
  name: 'Member',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  isDeleted: false,
  linkedProviders: [],
};
const ROLE = {
  id: 'role',
  version: 7,
  name: 'Support',
  slug: 'support',
  level: 1,
  permissions: [],
  isSystemRole: false,
  isProtected: false,
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
};

describe('staff version wire contract', () => {
  it('passes the returned version into every existing body mutation', async () => {
    const source = answering(200, { success: true, data: ACCOUNT });
    const transport = {
      ...source,
      request: (request: Parameters<typeof source.request>[0]) => {
        if (request.path.endsWith('/permissions')) {
          source.sent.push(request);
          return Promise.resolve(
            respond(200, {
              success: true,
              data: { userId: 'target', permissions: [], version: 7 },
            }),
          );
        }
        return source.request(request);
      },
    };
    const { admin } = createApiClient(transport);
    const target = await admin.accounts.get('target');
    await admin.accounts.update('target', { name: 'Next', version: target.version });
    await admin.accounts.updateStatus('target', { isActive: false, version: target.version });
    await admin.accounts.updateRole('target', { role: 'support', version: target.version });
    await admin.permissions.grant('target', {
      permission: 'users:read:all',
      version: target.version,
    });
    const roles = createApiClient(answering(200, { success: true, data: ROLE })).admin.roles;
    const role = await roles.get('role');
    await admin.roles.update('role', { level: 2, version: role.version });

    expect(transport.sent).toEqual([
      { method: 'GET', path: '/api/admin/users/target' },
      { method: 'PATCH', path: '/api/admin/users/target', body: { name: 'Next', version: 7 } },
      {
        method: 'PATCH',
        path: '/api/admin/users/target/status',
        body: { isActive: false, version: 7 },
      },
      {
        method: 'PATCH',
        path: '/api/admin/users/target/role',
        body: { role: 'support', version: 7 },
      },
      {
        method: 'POST',
        path: '/api/admin/users/target/permissions',
        body: { permission: 'users:read:all', version: 7 },
      },
      { method: 'PATCH', path: '/api/roles/role', body: { level: 2, version: 7 } },
    ]);
  });

  it('sends DELETE versions only in the query, including zero, with ordinary options intact', async () => {
    const transport = answering(200, {
      success: true,
      data: { userId: 'target', permissions: [] },
    });
    const { admin } = createApiClient(transport);
    const options = { version: 0, headers: { 'X-Request': 'keep' } };
    await admin.accounts.delete('a/b', options);
    await admin.accounts.cancelEmailChange('a/b', options);
    await admin.roles.delete('support', options);
    await admin.permissions.revoke('target', 'users:read:all', options);
    expect(transport.sent).toEqual([
      {
        method: 'DELETE',
        path: '/api/admin/users/a%2Fb?version=0',
        headers: { 'X-Request': 'keep' },
      },
      {
        method: 'DELETE',
        path: '/api/admin/users/a%2Fb/email-change?version=0',
        headers: { 'X-Request': 'keep' },
      },
      { method: 'DELETE', path: '/api/roles/support?version=0', headers: { 'X-Request': 'keep' } },
      {
        method: 'DELETE',
        path: '/api/admin/users/target/permissions/users%3Aread%3Aall?version=0',
        headers: { 'X-Request': 'keep' },
      },
    ]);
  });

  it('keeps omitted compatibility versions absent and forwards strict/stale refusals', async () => {
    const transport = answering(409, {
      success: false,
      error: { code: ErrorCode.CONFLICT, message: 'stale' },
    });
    const { admin } = createApiClient(transport);
    await expect(admin.accounts.delete('target')).rejects.toMatchObject({
      status: 409,
      code: ErrorCode.CONFLICT,
    });
    await expect(admin.roles.delete('role', { version: 3 })).rejects.toMatchObject({ status: 409 });
    expect(transport.sent).toEqual([
      { method: 'DELETE', path: '/api/admin/users/target' },
      { method: 'DELETE', path: '/api/roles/role?version=3' },
    ]);
  });
});
