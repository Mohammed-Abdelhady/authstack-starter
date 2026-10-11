import { ErrorCode } from '../../src/common/enums/error-code.enum';
import {
  SEED_ADMIN,
  SEED_MANAGER,
  SEED_USER,
  type SeedUser,
} from '../constants/seed-users';
import type { ApiBody, UserResponse } from '../types/e2e-responses';
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

const NEW_ADDRESS = 'created@seed.local';
const NEW_ACCOUNT = {
  email: NEW_ADDRESS,
  name: 'Created Person',
  password: 'SecureP@ssw0rd9',
};

describe('Role assignment ceiling (e2e)', () => {
  let e2e: E2eApp;
  let admin: TestAgent;
  let manager: TestAgent;
  let userId: string;

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
    manager = await loginAs(e2e.httpServer, SEED_MANAGER);
    userId = await idOf(SEED_USER);
  });

  async function idOf(seed: SeedUser): Promise<string> {
    const id = await e2e.state.accounts.accountIdFor(seed.email);
    if (!id) throw new Error(`seed user ${seed.email} is missing`);
    return id;
  }

  /** A custom role, which sits at the lowest level whatever it carries. */
  async function customRole(name: string, permissions: string[]) {
    await admin.post('/api/roles').send({ name, permissions }).expect(201);
  }

  function assign(agent: TestAgent, role: string) {
    return agent.patch(`/api/admin/users/${userId}/role`).send({ role });
  }

  async function storedRole(id: string): Promise<string | undefined> {
    return (await e2e.state.accounts.accountWithId(id))?.role;
  }

  function codeOf(response: { body: unknown }): string {
    return (response.body as ErrorBody).error.code;
  }

  it('refuses a role carrying the wildcard from an actor without it', async () => {
    await customRole('Shadow Root', ['*']);
    const user = await loginAs(e2e.httpServer, SEED_USER);

    const first = await assign(manager, 'shadow-root').expect(403);
    const second = await assign(manager, 'shadow-root').expect(403);

    expect([codeOf(first), codeOf(second)]).toEqual([
      ErrorCode.FORBIDDEN,
      ErrorCode.FORBIDDEN,
    ]);
    expect(await storedRole(userId)).toBe('user');
    // The target gained nothing, and the session it already had is still live.
    await user
      .patch('/api/roles/manager')
      .send({ permissions: ['*'] })
      .expect(403);
    await user.get('/api/user/profile').expect(200);
  });

  it('refuses a role carrying one permission the actor does not hold', async () => {
    await customRole('Role Reader', ['users:read:all', 'roles:list:all']);

    const refused = await assign(manager, 'role-reader').expect(403);

    expect(codeOf(refused)).toBe(ErrorCode.FORBIDDEN);
    expect(await storedRole(userId)).toBe('user');
  });

  it('lets an actor assign a custom role made of permissions it holds', async () => {
    await customRole('User Reader', ['users:read:all', 'roles:read:all']);

    await assign(manager, 'user-reader').expect(200);

    expect(await storedRole(userId)).toBe('user-reader');
  });

  it('lets a manager assign the support role, whose permissions it holds', async () => {
    await assign(manager, 'support').expect(200);

    expect(await storedRole(userId)).toBe('support');
  });

  it('lets a wildcard holder assign a role carrying the wildcard', async () => {
    await customRole('Shadow Root', ['*']);

    await assign(admin, 'shadow-root').expect(200);

    expect(await storedRole(userId)).toBe('shadow-root');
  });

  it('never assigns admin, and no role at the level of the actor', async () => {
    const byAdmin = await assign(admin, 'admin').expect(400);
    const byManager = await assign(manager, 'admin').expect(400);
    const ownLevel = await assign(manager, 'manager').expect(403);

    expect([codeOf(byAdmin), codeOf(byManager)]).toEqual([
      ErrorCode.INVALID_ROLE_ASSIGNMENT,
      ErrorCode.INVALID_ROLE_ASSIGNMENT,
    ]);
    expect(codeOf(ownLevel)).toBe(ErrorCode.CANNOT_MODIFY_HIGHER_ROLE);
    expect(await storedRole(userId)).toBe('user');
  });

  describe('creating an account', () => {
    async function creatingManager(): Promise<TestAgent> {
      await admin
        .post(`/api/admin/users/${await idOf(SEED_MANAGER)}/permissions`)
        .send({ permission: 'users:create:all' })
        .expect(200);
      return loginAs(e2e.httpServer, SEED_MANAGER);
    }

    it('refuses a role above the ceiling and stores no account', async () => {
      await customRole('Shadow Root', ['*']);
      const creator = await creatingManager();

      const refused = await creator
        .post('/api/admin/users')
        .send({ ...NEW_ACCOUNT, role: 'shadow-root' })
        .expect(403);

      expect(codeOf(refused)).toBe(ErrorCode.FORBIDDEN);
      expect(await e2e.state.accounts.accountIdFor(NEW_ADDRESS)).toBeNull();
    });

    it('creates an account on a role within the ceiling', async () => {
      const creator = await creatingManager();

      const created = await creator
        .post('/api/admin/users')
        .send({ ...NEW_ACCOUNT, role: 'support' })
        .expect(201);

      expect((created.body as ApiBody<UserResponse>).data.role).toBe('support');
    });

    it('never creates an admin', async () => {
      const refused = await admin
        .post('/api/admin/users')
        .send({ ...NEW_ACCOUNT, role: 'admin' })
        .expect(400);

      expect(codeOf(refused)).toBe(ErrorCode.INVALID_ROLE_ASSIGNMENT);
      expect(await e2e.state.accounts.accountIdFor(NEW_ADDRESS)).toBeNull();
    });
  });
});
