import type { ApiBody } from '../types/e2e-responses';
import request from 'supertest';
import type { Response } from 'supertest';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import type { RoleResponse } from '../types/e2e-responses';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('Role CRUD (e2e)', () => {
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

  describe('GET /api/roles', () => {
    it('should return all roles for admin with wildcard permission', async () => {
      const response: Response = await adminAgent.get('/api/roles').expect(200);

      const roles = (response.body as ApiBody<{ roles: RoleResponse[] }>).data
        .roles;
      expect(Array.isArray(roles)).toBe(true);
      expect(roles.length).toBeGreaterThan(0);

      const [role] = roles;
      expect(role).toHaveProperty('id');
      expect(role).toHaveProperty('name');
      expect(role).toHaveProperty('slug');
      expect(role).toHaveProperty('permissions');
      expect(role).toHaveProperty('isSystemRole');
      expect(role).toHaveProperty('isProtected');
    });

    it('should deny access for regular user without permission', async () => {
      await userAgent.get('/api/roles').expect(403);
    });

    it('should deny access for unauthenticated users', async () => {
      await request(e2e.httpServer).get('/api/roles').expect(401);
    });
  });

  describe('GET /api/roles/:slug', () => {
    it('should return a specific role by slug', async () => {
      const response: Response = await adminAgent
        .get('/api/roles/admin')
        .expect(200);

      const role = (response.body as ApiBody<RoleResponse>).data;
      expect(role.slug).toBe('admin');
      expect(role.name).toBe('Admin');
      expect(Array.isArray(role.permissions)).toBe(true);
    });

    it('should return 404 for non-existent role', async () => {
      await adminAgent.get('/api/roles/nonexistent-role').expect(404);
    });

    it('should deny access for regular user', async () => {
      await userAgent.get('/api/roles/admin').expect(403);
    });
  });

  describe('POST /api/roles', () => {
    it('should create a new role with valid data', async () => {
      const newRole = {
        name: 'Test Role',
        description: 'Role created during E2E testing',
        permissions: ['users:read:all', 'sessions:read:own'],
      };

      const response: Response = await adminAgent
        .post('/api/roles')
        .send(newRole)
        .expect(201);

      const role = (response.body as ApiBody<RoleResponse>).data;
      expect(role.name).toBe(newRole.name);
      expect(role.slug).toBe('test-role');
      expect(role.description).toBe(newRole.description);
      expect(role.permissions).toEqual(newRole.permissions);
      expect(role.isSystemRole).toBe(false);
      expect(role.isProtected).toBe(false);
    });

    it('should reject duplicate role names', async () => {
      await adminAgent
        .post('/api/roles')
        .send({ name: 'Test Role', permissions: ['users:read:all'] })
        .expect(409);
    });

    it('should validate required fields', async () => {
      await adminAgent
        .post('/api/roles')
        .send({ description: 'Missing name' })
        .expect(400);
    });

    it('should validate permission format', async () => {
      await adminAgent
        .post('/api/roles')
        .send({
          name: 'Invalid Permission Role',
          permissions: ['invalid-permission-format'],
        })
        .expect(400);
    });

    it('should deny access for regular user', async () => {
      await userAgent
        .post('/api/roles')
        .send({ name: 'User Role', permissions: [] })
        .expect(403);
    });
  });

  describe('PATCH /api/roles/:slug', () => {
    it('should update a non-protected role', async () => {
      const updates = {
        description: 'Updated description',
        permissions: ['users:read:all', 'roles:read:all'],
      };

      const response: Response = await adminAgent
        .patch('/api/roles/test-role')
        .send(updates)
        .expect(200);

      const role = (response.body as ApiBody<RoleResponse>).data;
      expect(role.description).toBe(updates.description);
      expect(role.permissions).toEqual(updates.permissions);
    });

    it('should allow updating description of protected role', async () => {
      const updates = { description: 'Updated user role description' };

      const response: Response = await adminAgent
        .patch('/api/roles/user')
        .send(updates)
        .expect(200);

      expect((response.body as ApiBody<RoleResponse>).data.description).toBe(
        updates.description,
      );
    });

    it('should prevent renaming protected roles', async () => {
      await adminAgent
        .patch('/api/roles/user')
        .send({ name: 'Renamed User' })
        .expect(403);
    });

    it('should return 404 for non-existent role', async () => {
      await adminAgent
        .patch('/api/roles/nonexistent')
        .send({ description: 'Test' })
        .expect(404);
    });

    it('should deny access for regular user', async () => {
      await userAgent
        .patch('/api/roles/test-role')
        .send({ description: 'Unauthorized update' })
        .expect(403);
    });
  });

  describe('DELETE /api/roles/:slug', () => {
    it('should prevent deletion of protected roles', async () => {
      await adminAgent.delete('/api/roles/user').expect(403);
    });

    it('should delete non-protected custom roles', async () => {
      await adminAgent.delete('/api/roles/test-role').expect(204);

      await adminAgent.get('/api/roles/test-role').expect(404);
    });

    it('should return 404 for non-existent role', async () => {
      await adminAgent.delete('/api/roles/nonexistent').expect(404);
    });

    it('should deny access for regular user', async () => {
      await userAgent.delete('/api/roles/test-role').expect(403);
    });
  });
});
