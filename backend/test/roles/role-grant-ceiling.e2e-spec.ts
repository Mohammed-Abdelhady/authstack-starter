import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { DEFAULT_ROLE_PERMISSIONS } from '../../src/common/constants/permissions';
import { SEED_ADMIN, SEED_MANAGER } from '../constants/seed-users';
import type {
  ApiBody,
  RoleResponse,
  UserResponse,
} from '../types/e2e-responses';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface ErrorBody {
  error: { code: string };
}

describe('Role permission ceiling (e2e)', () => {
  let e2e: E2eApp;
  let admin: TestAgent;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
  });

  /** The manager signs in after the grants, so the session carries them. */
  async function managerWith(permissions: string[]): Promise<TestAgent> {
    const before = await loginAs(e2e.httpServer, SEED_MANAGER);
    const profile = await before.get('/api/user/profile').expect(200);
    const id = (profile.body as ApiBody<UserResponse>).data.id;
    for (const permission of permissions) {
      await admin
        .post(`/api/admin/users/${id}/permissions`)
        .send({ permission })
        .expect(200);
    }
    return loginAs(e2e.httpServer, SEED_MANAGER);
  }

  async function managerRolePermissions(): Promise<string[]> {
    const role = await admin.get('/api/roles/manager').expect(200);
    return (role.body as ApiBody<RoleResponse>).data.permissions;
  }

  it('refuses a manager who gives the manager role the wildcard', async () => {
    const manager = await managerWith(['roles:update:all']);

    const refused = await manager
      .patch('/api/roles/manager')
      .send({ permissions: ['*'] })
      .expect(403);

    expect((refused.body as ErrorBody).error.code).toBe(
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    );
    expect(await managerRolePermissions()).toEqual([
      ...DEFAULT_ROLE_PERMISSIONS.manager,
    ]);
  });

  it('refuses a manager who creates a role carrying the wildcard', async () => {
    const manager = await managerWith(['roles:create:all']);

    const refused = await manager
      .post('/api/roles')
      .send({ name: 'Shadow Admin', permissions: ['*'] })
      .expect(403);

    expect((refused.body as ErrorBody).error.code).toBe(ErrorCode.FORBIDDEN);
    await admin.get('/api/roles/shadow-admin').expect(404);
  });

  it('lets that manager create a role from a permission they hold', async () => {
    const manager = await managerWith(['roles:create:all']);

    const created = await manager
      .post('/api/roles')
      .send({ name: 'Role Maker', permissions: ['roles:create:all'] })
      .expect(201);

    expect((created.body as ApiBody<RoleResponse>).data.permissions).toEqual([
      'roles:create:all',
    ]);
  });
});
