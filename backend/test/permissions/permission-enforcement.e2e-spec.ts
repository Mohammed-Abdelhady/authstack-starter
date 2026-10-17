import type { ApiBody } from '../types/e2e-responses';
import { replacePermissions } from '../utils/permissions';
import type { Response } from 'supertest';
import {
  bootE2eApp,
  browserAgent, // feature:email-password
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import type { UserResponse } from '../types/e2e-responses';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const BASE_PERMISSIONS = ['profile:read:own', 'profile:update:own'];

describe('Permission enforcement (e2e)', () => {
  let e2e: E2eApp;
  let adminAgent: TestAgent;
  let userAgent: TestAgent;
  let testUserId: string;

  const setPermissions = async (permissions: string[]): Promise<void> => {
    await replacePermissions(adminAgent, testUserId, permissions);
  };

  beforeAll(async () => {
    e2e = await bootE2eApp();

    adminAgent = await loginAs(e2e.httpServer, SEED_ADMIN);
    userAgent = await loginAs(e2e.httpServer, SEED_USER);

    const meResponse: Response = await userAgent
      .get('/api/user/profile')
      .expect(200);
    testUserId = (meResponse.body as ApiBody<UserResponse>).data.id;
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  describe('Permission checking logic', () => {
    it('should grant access with wildcard permission', async () => {
      await e2e.state.records.replaceAccountPermissions(testUserId, ['*']);

      await userAgent.get('/api/roles').expect(200);

      await setPermissions(BASE_PERMISSIONS);
    });

    it('should deny access without required permission', async () => {
      await userAgent.get('/api/roles').expect(403);
    });

    it('should grant access with specific permission', async () => {
      await adminAgent
        .post(`/api/admin/users/${testUserId}/permissions`)
        .send({ permission: 'roles:list:all' });

      await userAgent.get('/api/roles').expect(200);

      await adminAgent.delete(
        `/api/admin/users/${testUserId}/permissions/roles%3Alist%3Aall`,
      );
    });
  });

  describe('Permission inheritance', () => {
    // feature:email-password:start
    it('should allow users with same role to have different permissions', async () => {
      const userResponse: Response = await userAgent
        .get('/api/user/profile')
        .expect(200);

      const registerAgent = await browserAgent(e2e.httpServer);
      const registerResponse: Response = await registerAgent
        .post('/api/auth/register')
        .send({ email: 'testuser@test.local' })
        .expect(200);

      expect((userResponse.body as ApiBody<UserResponse>).data.role).toBe(
        'user',
      );
      expect(registerResponse.body).toHaveProperty('success', true);
      const message = (await e2e.captureMail()).at(-1);
      const code = message?.text?.match(/\b\d{6}\b/)?.[0];
      expect(code).toBeDefined();
      const activated = await browserAgent(e2e.httpServer);
      await activated
        .post('/api/auth/activate')
        .send({
          email: 'testuser@test.local',
          code,
          password: 'Test1234!',
          name: 'Test User',
        })
        .expect(200);
      const profile = await activated.get('/api/user/profile').expect(200);
      expect((profile.body as ApiBody<UserResponse>).data.role).toBe('user');
      expect(await e2e.captureMail()).toHaveLength(1);
    });
    // feature:email-password:end
  });

  describe('Protected permissions', () => {
    it('should validate permission format against allowed permissions', async () => {
      await adminAgent
        .post(`/api/admin/users/${testUserId}/permissions`)
        .send({ permission: 'invalid permission' })
        .expect(400);
    });

    it('should accept all valid permission combinations', async () => {
      const validPermissions = [
        'users:read:all',
        'users:create:all',
        'users:update:all',
        'users:delete:all',
        'roles:read:all',
        'roles:manage:all',
        'permissions:grant:all',
        'permissions:revoke:all',
        'sessions:read:all',
        'sessions:delete:own',
        'reports:read:all',
        'reports:create:all',
        'profile:read:own',
        'profile:update:own',
      ];

      const response = await replacePermissions(
        adminAgent,
        testUserId,
        validPermissions,
      );

      expect(
        [...(response.body as ApiBody<UserResponse>).data.permissions].sort(),
      ).toEqual([...validPermissions].sort());

      await setPermissions(BASE_PERMISSIONS);
    });
  });

  describe('Multiple permission checks', () => {});
});
