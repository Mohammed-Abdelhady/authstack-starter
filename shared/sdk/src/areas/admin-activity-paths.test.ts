import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';
import { ADMIN_PATHS } from './admin';

const ACTIVITY = {
  id: 'event-1',
  occurredAt: '2026-10-15T09:00:00.000Z',
  action: 'role.assigned',
  outcome: 'success',
  actorId: 'staff-1',
  targetUserId: 'account-1',
  clientId: null,
  sessionId: null,
  details: { reason: 'repair', count: 2, completed: true, permissions: ['users:read:all'] },
  roleAssignment: { assignedRoleId: 'role-2', previousRoleId: null },
};

describe('admin activity', () => {
  it('h26 combines every filter and sends UTC timestamp bounds', async () => {
    const transport = answering(200, {
      success: true,
      data: { data: [ACTIVITY], pagination: { page: 2, limit: 10, total: 25, totalPages: 3 } },
    });
    const result = await createApiClient(transport).admin.activity.list({
      page: 2,
      limit: 10,
      actor: 'staff/1',
      action: 'role.assigned',
      target: 'account?1',
      from: '2026-10-15T08:00:00.000Z',
      to: '2026-10-15T10:00:00.000Z',
    });

    expect(transport.sent).toStrictEqual([
      {
        method: 'GET',
        path: '/api/admin/activity?page=2&limit=10&actor=staff%2F1&action=role.assigned&target=account%3F1&from=2026-10-15T08%3A00%3A00.000Z&to=2026-10-15T10%3A00%3A00.000Z',
      },
    ]);
    expect(result.data).toStrictEqual([
      {
        id: 'event-1',
        occurredAt: '2026-10-15T09:00:00.000Z',
        action: 'role.assigned',
        outcome: 'success',
        actorId: 'staff-1',
        targetUserId: 'account-1',
        clientId: null,
        sessionId: null,
        details: { reason: 'repair', count: 2, completed: true, permissions: ['users:read:all'] },
        roleAssignment: { assignedRoleId: 'role-2', previousRoleId: null },
      },
    ]);
    expect(result.pagination).toStrictEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
  });

  it('h26 omits absent query parameters without adding a question mark', async () => {
    const transport = answering(200, {
      success: true,
      data: { data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } },
    });
    const { activity } = createApiClient(transport).admin;
    await activity.list();
    await activity.list({});

    expect(transport.sent).toStrictEqual([
      { method: 'GET', path: '/api/admin/activity' },
      { method: 'GET', path: '/api/admin/activity' },
    ]);
  });
});

describe('admin path boundaries', () => {
  it.each(['', '.', '..'])('h27 refuses unsafe segments %j before I/O', async (segment) => {
    const transport = answering(200, { success: true, data: {} });
    const { admin } = createApiClient(transport);
    const calls = [
      () => admin.accounts.get(segment),
      () => admin.accounts.update(segment, {}),
      () => admin.accounts.delete(segment),
      () => admin.accounts.updateStatus(segment, { isActive: true }),
      () => admin.accounts.updateRole(segment, { role: 'support' }),
      () => admin.accounts.resendEmailChange(segment),
      () => admin.permissions.list(segment),
      () => admin.permissions.grant(segment, { permission: 'users:read:all' }),
      () => admin.permissions.revoke(segment, 'users:read:all'),
      () => admin.permissions.revoke('account-1', segment),
      () => admin.roles.get(segment),
      () => admin.roles.update(segment, {}),
      () => admin.roles.delete(segment),
      () => admin.sessions.list(segment),
      () => admin.sessions.revoke(segment, 'session-1'),
      () => admin.sessions.revoke('account-1', segment),
      () => admin.sessions.revokeAll(segment),
    ];

    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(TypeError);
    expect(transport.sent).toStrictEqual([]);
  });

  it('h27 encodes reserved characters in every segment position', () => {
    expect(ADMIN_PATHS.account('a/b?#')).toBe('/api/admin/users/a%2Fb%3F%23');
    expect(ADMIN_PATHS.role('a/b?#')).toBe('/api/roles/a%2Fb%3F%23');
    expect(ADMIN_PATHS.permission('a/b?#', 'users:read/all?#')).toBe(
      '/api/admin/users/a%2Fb%3F%23/permissions/users%3Aread%2Fall%3F%23',
    );
    expect(ADMIN_PATHS.session('a/b?#', 's/b?#')).toBe(
      '/api/admin/users/a%2Fb%3F%23/sessions/s%2Fb%3F%23',
    );
  });
});
