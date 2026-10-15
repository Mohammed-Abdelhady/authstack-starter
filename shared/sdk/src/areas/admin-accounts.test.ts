import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';
import type { AdminAccountRoleResult, AdminAccountStatusResult } from './admin';

const ACCOUNT = {
  id: 'account-1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'support',
  permissions: ['users:read:all'],
  authProvider: 'email',
  isVerified: true,
  isDeleted: false,
  linkedProviders: ['email'],
};

const CREATE_BODY = {
  email: 'layla@example.com',
  name: 'Layla',
  password: 'a-strong-password',
  role: 'support',
  locale: 'en-GB',
};

describe('admin accounts', () => {
  it('h21 accepts account and role empty 204 deletes as void', async () => {
    const transport = answering(204);
    const { admin } = createApiClient(transport);

    expect(await admin.accounts.delete('account-1')).toBeUndefined();
    expect(await admin.roles.delete('support')).toBeUndefined();
    expect(transport.sent).toStrictEqual([
      { method: 'DELETE', path: '/api/admin/users/account-1' },
      { method: 'DELETE', path: '/api/roles/support' },
    ]);
  });

  it('h21 keeps delete refusals instead of reporting success', async () => {
    const transport = answering(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Refused' },
    });
    const { admin } = createApiClient(transport);

    await expect(admin.accounts.delete('account-1')).rejects.toMatchObject({ status: 403 });
    await expect(admin.roles.delete('support')).rejects.toMatchObject({ status: 403 });
  });

  it('h22 forwards account filters and reads account pagination', async () => {
    const transport = answering(200, {
      success: true,
      data: {
        data: [ACCOUNT],
        pagination: { page: 2, limit: 1, total: 3, totalPages: 3 },
      },
    });
    const result = await createApiClient(transport).admin.accounts.list({
      page: 2,
      limit: 1,
      search: 'Layla & team',
      role: 'support',
      status: 'inactive',
      isVerified: false,
      sortBy: 'email',
      sortOrder: 'asc',
    });

    expect(transport.sent).toStrictEqual([
      {
        method: 'GET',
        path: '/api/admin/users?page=2&limit=1&search=Layla%20%26%20team&role=support&status=inactive&isVerified=false&sortBy=email&sortOrder=asc',
      },
    ]);
    expect(result.data[0]?.id).toBe('account-1');
    expect(result.pagination).toStrictEqual({ page: 2, limit: 1, total: 3, totalPages: 3 });
  });

  it('h22 forwards create and update fields and reads the real account', async () => {
    const transport = answering(201, { success: true, data: ACCOUNT });
    const { accounts } = createApiClient(transport).admin;
    const created = await accounts.create(CREATE_BODY, { operation: { operationKey: 'create-1' } });
    const updated = await accounts.update('account-1', {
      name: 'Layla updated',
      email: 'next@example.com',
    });
    const fetched = await accounts.get('account-1');

    expect(transport.sent).toStrictEqual([
      {
        method: 'POST',
        path: '/api/admin/users',
        body: {
          email: 'layla@example.com',
          name: 'Layla',
          password: 'a-strong-password',
          role: 'support',
          locale: 'en-GB',
        },
        operationKey: 'create-1',
      },
      {
        method: 'PATCH',
        path: '/api/admin/users/account-1',
        body: { name: 'Layla updated', email: 'next@example.com' },
      },
      { method: 'GET', path: '/api/admin/users/account-1' },
    ]);
    expect([created.id, updated.id, fetched.id]).toStrictEqual([
      'account-1',
      'account-1',
      'account-1',
    ]);
  });

  it('h22 preserves partial status and role replies without inventing account fields', async () => {
    const statusTransport = answering(200, {
      success: true,
      data: { id: 'account-1', isDeleted: true, deletedAt: '2026-10-15T09:00:00.000Z' },
    });
    const roleTransport = answering(200, {
      success: true,
      data: { id: 'account-1', role: 'manager' },
    });
    const status: AdminAccountStatusResult = await createApiClient(
      statusTransport,
    ).admin.accounts.updateStatus('account-1', { isActive: false, reason: 'requested' });
    const role: AdminAccountRoleResult = await createApiClient(
      roleTransport,
    ).admin.accounts.updateRole('account-1', { role: 'manager' });

    expect(status).toStrictEqual({
      id: 'account-1',
      isDeleted: true,
      deletedAt: '2026-10-15T09:00:00.000Z',
    });
    expect(role).toStrictEqual({ id: 'account-1', role: 'manager' });
    expect(statusTransport.sent).toStrictEqual([
      {
        method: 'PATCH',
        path: '/api/admin/users/account-1/status',
        body: { isActive: false, reason: 'requested' },
      },
    ]);
    expect(roleTransport.sent).toStrictEqual([
      { method: 'PATCH', path: '/api/admin/users/account-1/role', body: { role: 'manager' } },
    ]);
  });

  it('h22 resends an email change without adding a body', async () => {
    const transport = answering(200, { success: true, data: { message: 'resent' } });

    expect(
      await createApiClient(transport).admin.accounts.resendEmailChange('account-1'),
    ).toStrictEqual({ message: 'resent' });
    expect(transport.sent).toStrictEqual([
      { method: 'POST', path: '/api/admin/users/account-1/resend-email-change' },
    ]);
  });

  it('h16 allocates independent metadata keys and h17 reuses a supplied operation', async () => {
    const createOperationKey = vi
      .fn<() => string>()
      .mockReturnValueOnce('new-create-1')
      .mockReturnValueOnce('new-create-2');
    const transport = answering(201, { success: true, data: ACCOUNT });
    const { accounts } = createApiClient(transport).admin;
    await accounts.create(CREATE_BODY, { createOperationKey });
    await accounts.create(CREATE_BODY, { createOperationKey });
    await accounts.create(CREATE_BODY, {
      operation: { operationKey: 'resume-1' },
      createOperationKey,
    });
    await accounts.create(CREATE_BODY, {
      operation: { operationKey: 'resume-1' },
      createOperationKey,
    });
    const keys = transport.sent.map((request) =>
      'operationKey' in request ? request.operationKey : undefined,
    );

    expect(keys).toStrictEqual(['new-create-1', 'new-create-2', 'resume-1', 'resume-1']);
    expect(createOperationKey).toHaveBeenCalledTimes(2);
    for (const request of transport.sent) {
      expect(request.headers).toBeUndefined();
      expect(request.body).toStrictEqual({
        email: 'layla@example.com',
        name: 'Layla',
        password: 'a-strong-password',
        role: 'support',
        locale: 'en-GB',
      });
    }
  });
});

describe('admin permissions', () => {
  it('h23 separates read role metadata from grant and revoke results', async () => {
    const readTransport = answering(200, {
      success: true,
      data: { userId: 'account-1', permissions: ['users:read:all'], role: 'support' },
    });
    const writeTransport = answering(200, {
      success: true,
      data: { userId: 'account-1', permissions: ['users:read:all'] },
    });
    const read = await createApiClient(readTransport).admin.permissions.list('account-1');
    const { permissions } = createApiClient(writeTransport).admin;
    const grant = await permissions.grant('account-1', { permission: 'users:read:all' });
    const revoke = await permissions.revoke('account-1', 'users:read/all?#');

    expect(read).toStrictEqual({
      userId: 'account-1',
      permissions: ['users:read:all'],
      role: 'support',
    });
    expect(grant).toStrictEqual({ userId: 'account-1', permissions: ['users:read:all'] });
    expect(revoke).toStrictEqual({ userId: 'account-1', permissions: ['users:read:all'] });
    expect(readTransport.sent).toStrictEqual([
      { method: 'GET', path: '/api/admin/users/account-1/permissions' },
    ]);
    expect(writeTransport.sent).toStrictEqual([
      {
        method: 'POST',
        path: '/api/admin/users/account-1/permissions',
        body: { permission: 'users:read:all' },
      },
      { method: 'DELETE', path: '/api/admin/users/account-1/permissions/users%3Aread%2Fall%3F%23' },
    ]);
  });
});
