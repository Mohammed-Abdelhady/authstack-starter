import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering, respond } from '../test-support';
import type { TransportRequest } from '../transport';

function observedVersion(value: number | undefined): number {
  if (value === undefined) throw new Error('Permission response did not include a version');
  return value;
}

it('carries actual returned permission versions through grant and revoke requests', async () => {
  const sent: TransportRequest[] = [];
  const client = createApiClient({
    request: async (request) => {
      sent.push(request);
      const version = request.method === 'GET' ? 0 : 9;
      return respond(200, {
        success: true,
        data: {
          userId: 'target',
          role: 'support',
          permissions: [],
          version,
        },
      });
    },
  });
  const listed = await client.admin.permissions.list('target');
  const granted = await client.admin.permissions.grant('target', {
    permission: 'profile:read:own',
    version: observedVersion(listed.version),
  });
  await client.admin.permissions.revoke('target', 'profile:read:own', {
    version: observedVersion(granted.version),
  });
  expect(sent).toEqual([
    { method: 'GET', path: '/api/admin/users/target/permissions' },
    {
      method: 'POST',
      path: '/api/admin/users/target/permissions',
      body: { permission: 'profile:read:own', version: 0 },
    },
    {
      method: 'DELETE',
      path: '/api/admin/users/target/permissions/profile%3Aread%3Aown?version=9',
    },
  ]);
});

describe('malformed permission version refusal', () => {
  it.each([null, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1])(
    'refuses an unusable observed version',
    async (version) => {
      const client = createApiClient(
        answering(200, {
          success: true,
          data: {
            userId: 'target',
            permissions: [],
            role: 'support',
            version,
          },
        }),
      );
      await expect(client.admin.permissions.list('target')).rejects.toMatchObject({ status: 200 });
    },
  );
});

it('keeps an explicitly legacy permission response version absent rather than fabricating zero', async () => {
  const client = createApiClient(
    answering(200, { success: true, data: { userId: 'target', role: 'support', permissions: [] } }),
  );
  const result = await client.admin.permissions.list('target');
  expect(result).toStrictEqual({ userId: 'target', role: 'support', permissions: [] });
});
