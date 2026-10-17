import type { ApiBody } from '../types/e2e-responses';
import type { Response } from 'supertest';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { SEED_ADMIN, SEED_SUPPORT } from '../constants/seed-users';
import type { RoleResponse } from '../types/e2e-responses';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('Role access and permission validation (e2e)', () => {
  let e2e: E2eApp;
  let adminAgent: TestAgent;

  beforeAll(async () => {
    e2e = await bootE2eApp();

    adminAgent = await loginAs(e2e.httpServer, SEED_ADMIN);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  describe('Permission validation', () => {
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

  describe('Role hierarchy and system roles', () => {});

  describe('Session-based authentication', () => {
    it('should reject requests after logout', async () => {
      const tempAgent = await loginAs(e2e.httpServer, SEED_SUPPORT);

      // Authenticated, but the support role holds no role permissions
      await tempAgent.get('/api/roles').expect(403);

      await tempAgent.post('/api/auth/logout').expect(200);

      await tempAgent.get('/api/roles').expect(401);
    });
  });

  describe('Effective permissions per user', () => {});
});
