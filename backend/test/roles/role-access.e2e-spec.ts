import type { ApiBody } from '../types/e2e-responses';
import type { Response } from 'supertest';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { SEED_ADMIN, SEED_SUPPORT, SEED_USER } from '../constants/seed-users';
import type { RoleResponse, UserResponse } from '../types/e2e-responses';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('Role access and permission validation (e2e)', () => {
  let e2e: E2eApp;
  let adminAgent: TestAgent;
  let userAgent: TestAgent;

  beforeAll(async () => {
    e2e = await bootE2eApp();

    adminAgent = await loginAs(e2e.httpServer, SEED_ADMIN);
    userAgent = await loginAs(e2e.httpServer, SEED_USER);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  describe('Permission validation', () => {
    it('should accept valid permission formats', async () => {
      const validPermissions = [
        'users:read:all',
        'users:read:own',
        'roles:manage:all',
        'sessions:delete:own',
        'reports:create:all',
      ];

      const response: Response = await adminAgent
        .post('/api/roles')
        .send({ name: 'Valid Permissions Role', permissions: validPermissions })
        .expect(201);

      const role = (response.body as ApiBody<RoleResponse>).data;
      expect(role.permissions).toEqual(validPermissions);

      await adminAgent.delete(`/api/roles/${role.slug}`);
    });

    it('should accept wildcard permission', async () => {
      const response: Response = await adminAgent
        .post('/api/roles')
        .send({ name: 'Wildcard Role', permissions: ['*'] })
        .expect(201);

      const role = (response.body as ApiBody<RoleResponse>).data;
      expect(role.permissions).toContain('*');

      await adminAgent.delete(`/api/roles/${role.slug}`);
    });
  });

  describe('Role hierarchy and system roles', () => {
    it('should mark seeded roles as system roles', async () => {
      const response: Response = await adminAgent.get('/api/roles').expect(200);

      const systemRoles = (
        response.body as ApiBody<{ roles: RoleResponse[] }>
      ).data.roles.filter((role) => role.isSystemRole);

      expect(systemRoles.length).toBeGreaterThan(0);
      expect(systemRoles.some((role) => role.slug === 'admin')).toBe(true);
      expect(systemRoles.some((role) => role.slug === 'user')).toBe(true);
    });

    it('should mark USER role as protected', async () => {
      const response: Response = await adminAgent
        .get('/api/roles/user')
        .expect(200);

      expect((response.body as ApiBody<RoleResponse>).data.isProtected).toBe(
        true,
      );
    });
  });

  describe('Session-based authentication', () => {
    it('should maintain session across multiple requests', async () => {
      await adminAgent.get('/api/roles').expect(200);
      await adminAgent.get('/api/roles').expect(200);
    });

    it('should reject requests after logout', async () => {
      const tempAgent = await loginAs(e2e.httpServer, SEED_SUPPORT);

      // Authenticated, but the support role holds no role permissions
      await tempAgent.get('/api/roles').expect(403);

      await tempAgent.post('/api/auth/logout').expect(200);

      await tempAgent.get('/api/roles').expect(401);
    });
  });

  describe('Effective permissions per user', () => {
    it('should verify admin has wildcard permission', async () => {
      const response: Response = await adminAgent
        .get('/api/user/profile')
        .expect(200);

      expect(
        (response.body as ApiBody<UserResponse>).data.permissions,
      ).toContain('*');
    });

    it('should verify regular user has limited permissions', async () => {
      const response: Response = await userAgent
        .get('/api/user/profile')
        .expect(200);

      const user = (response.body as ApiBody<UserResponse>).data;
      expect(user.permissions).not.toContain('*');
      expect(user.permissions).not.toContain('users:read:all');
    });
  });
});
