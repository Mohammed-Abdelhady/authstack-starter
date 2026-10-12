import type { ApiBody } from '../types/e2e-responses';
import { replacePermissions } from '../utils/permissions';
import { ABSENT_ID } from '../utils/route-id-answers';
import type { Response } from 'supertest';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { SEED_ADMIN, SEED_MANAGER, SEED_USER } from '../constants/seed-users';
import type { PermissionsResponse, UserResponse } from '../types/e2e-responses';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const BASE_PERMISSIONS = ['profile:read:own', 'profile:update:own'];

describe('Admin permission routes (e2e)', () => {
  let e2e: E2eApp;
  let adminAgent: TestAgent;
  let managerAgent: TestAgent;
  let userAgent: TestAgent;
  let testUserId: string;

  const restoreBasePermissions = async (): Promise<void> => {
    await replacePermissions(adminAgent, testUserId, BASE_PERMISSIONS);
  };

  beforeAll(async () => {
    e2e = await bootE2eApp();

    adminAgent = await loginAs(e2e.httpServer, SEED_ADMIN);
    managerAgent = await loginAs(e2e.httpServer, SEED_MANAGER);
    userAgent = await loginAs(e2e.httpServer, SEED_USER);

    const meResponse: Response = await userAgent
      .get('/api/user/profile')
      .expect(200);
    testUserId = (meResponse.body as ApiBody<UserResponse>).data.id;
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  describe('GET /api/admin/users/:id/permissions', () => {
    it('should return user permissions for admin', async () => {
      const response: Response = await adminAgent
        .get(`/api/admin/users/${testUserId}/permissions`)
        .expect(200);

      const body = (response.body as ApiBody<PermissionsResponse>).data;
      expect(body).toHaveProperty('permissions');
      expect(Array.isArray(body.permissions)).toBe(true);
    });

    it('should deny access for regular user', async () => {
      await userAgent
        .get(`/api/admin/users/${testUserId}/permissions`)
        .expect(403);
    });

    it('should return 404 for non-existent user', async () => {
      await adminAgent
        .get(`/api/admin/users/${ABSENT_ID}/permissions`)
        .expect(404);
    });
  });

  describe('Individual permission grants replacing retired bulk updates', () => {
    it('should update user permissions for admin', async () => {
      const newPermissions = [
        'profile:read:own',
        'profile:update:own',
        'sessions:read:own',
      ];

      const response = await replacePermissions(
        adminAgent,
        testUserId,
        newPermissions,
      );

      const body = (response.body as ApiBody<PermissionsResponse>).data;
      expect(body.permissions).toEqual(newPermissions);
    });

    it('should reject a direct wildcard grant without changing permissions', async () => {
      const path = `/api/admin/users/${testUserId}/permissions`;
      const before = await adminAgent.get(path).expect(200);
      await adminAgent.post(path).send({ permission: '*' }).expect(400);
      const after = await adminAgent.get(path).expect(200);
      expect(
        (after.body as ApiBody<PermissionsResponse>).data.permissions,
      ).toEqual((before.body as ApiBody<PermissionsResponse>).data.permissions);
    });

    it('should validate permission format', async () => {
      await adminAgent
        .post(`/api/admin/users/${testUserId}/permissions`)
        .send({ permission: 'invalid-format' })
        .expect(400);
    });

    it('should allow empty permissions array', async () => {
      const response = await replacePermissions(adminAgent, testUserId, []);

      const body = (response.body as ApiBody<PermissionsResponse>).data;
      expect(body.permissions).toEqual([]);

      await restoreBasePermissions();
    });

    it('should deny access for regular user', async () => {
      await userAgent
        .post(`/api/admin/users/${testUserId}/permissions`)
        .send({ permission: 'users:read:all' })
        .expect(403);
    });

    it('should deny access for manager without permission management rights', async () => {
      await managerAgent
        .post(`/api/admin/users/${testUserId}/permissions`)
        .send({ permission: 'users:read:all' })
        .expect(403);
    });
  });

  describe('POST /api/admin/users/:id/permissions', () => {
    it('should add permissions to user', async () => {
      const response: Response = await adminAgent
        .post(`/api/admin/users/${testUserId}/permissions`)
        .send({ permission: 'reports:read:all' })
        .expect(200);

      const body = (response.body as ApiBody<PermissionsResponse>).data;
      expect(body.permissions).toContain('reports:read:all');
    });

    it('should not duplicate existing permissions', async () => {
      const path = `/api/admin/users/${testUserId}/permissions`;
      await adminAgent
        .post(path)
        .send({ permission: 'profile:read:own' })
        .expect(400);
      const response = await adminAgent.get(path).expect(200);
      const body = (response.body as ApiBody<PermissionsResponse>).data;
      expect(
        body.permissions.filter(
          (permission) => permission === 'profile:read:own',
        ),
      ).toHaveLength(1);
    });

    it('should deny access for regular user', async () => {
      await userAgent
        .post(`/api/admin/users/${testUserId}/permissions`)
        .send({ permission: 'users:read:all' })
        .expect(403);
    });
  });

  describe('DELETE /api/admin/users/:id/permissions', () => {
    it('should remove specific permissions from user', async () => {
      const response: Response = await adminAgent
        .delete(
          `/api/admin/users/${testUserId}/permissions/reports%3Aread%3Aall`,
        )
        .expect(200);

      const body = (response.body as ApiBody<PermissionsResponse>).data;
      expect(body.permissions).not.toContain('reports:read:all');
    });

    it('should handle removing non-existent permissions gracefully', async () => {
      const response: Response = await adminAgent
        .delete(
          `/api/admin/users/${testUserId}/permissions/nonexistent%3Apermission`,
        )
        .expect(404);

      expect(response.body).toHaveProperty(
        'error.code',
        'PERMISSION_NOT_FOUND',
      );
    });

    it('should deny access for regular user', async () => {
      await userAgent
        .delete(
          `/api/admin/users/${testUserId}/permissions/profile%3Aread%3Aown`,
        )
        .expect(403);
    });
  });
});
