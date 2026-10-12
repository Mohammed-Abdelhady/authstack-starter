import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UserRole } from '../../src/user/enums/user-role.enum';
import {
  SEED_ADMIN,
  SEED_MANAGER,
  SEED_USER,
  type SeedUser,
} from '../constants/seed-users';
import type { ApiBody, PermissionsResponse } from '../types/e2e-responses';
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

const USER_BASE = ['profile:read:own', 'profile:update:own'];
/** Held by the manager through its role. */
const HELD = 'users:read:all';
/** Opens `GET /api/roles`, which the seeded manager cannot call. */
const UNHELD = 'roles:list:all';

describe('Direct permission ceiling (e2e)', () => {
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

  async function idOf(seed: SeedUser): Promise<string> {
    const id = await e2e.state.accounts.accountIdFor(seed.email);
    if (!id) throw new Error(`seed user ${seed.email} is missing`);
    return id;
  }

  /** A manager who may grant and revoke, and holds nothing else beyond its role. */
  async function grantingManager(): Promise<TestAgent> {
    await e2e.state.records.replaceAccountPermissions(
      await idOf(SEED_MANAGER),
      ['permissions:grant:all', 'permissions:revoke:all'],
    );
    return loginAs(e2e.httpServer, SEED_MANAGER);
  }

  async function storedPermissions(id: string): Promise<string[]> {
    const stored = await e2e.state.accounts.accountWithId(id);
    if (!stored) throw new Error(`account ${id} is missing`);
    return stored.permissions;
  }

  function grant(agent: TestAgent, id: string, permission: unknown) {
    return agent
      .post(`/api/admin/users/${id}/permissions`)
      .send({ permission });
  }

  function revoke(agent: TestAgent, id: string, permission: string) {
    return agent.delete(
      `/api/admin/users/${id}/permissions/${encodeURIComponent(permission)}`,
    );
  }

  function codeOf(response: { body: unknown }): string {
    return (response.body as ErrorBody).error.code;
  }

  it('lets an actor grant a permission it holds', async () => {
    const manager = await grantingManager();
    const userId = await idOf(SEED_USER);

    const granted = await grant(manager, userId, HELD).expect(200);

    expect(
      (granted.body as ApiBody<PermissionsResponse>).data.permissions,
    ).toEqual([...USER_BASE, HELD]);
    expect(await storedPermissions(userId)).toEqual([...USER_BASE, HELD]);
  });

  it('refuses a permission the actor does not hold and stores nothing', async () => {
    const manager = await grantingManager();
    const userId = await idOf(SEED_USER);
    const user = await loginAs(e2e.httpServer, SEED_USER);

    const refused = await grant(manager, userId, UNHELD).expect(403);

    expect(codeOf(refused)).toBe(ErrorCode.FORBIDDEN);
    expect(await storedPermissions(userId)).toEqual(USER_BASE);
    // The target cannot use it, and the session it already had is still live.
    await user.get('/api/roles').expect(403);
    await user.get('/api/user/profile').expect(200);
  });

  it('answers the same refusal when the request is repeated', async () => {
    const manager = await grantingManager();
    const userId = await idOf(SEED_USER);

    const first = await grant(manager, userId, UNHELD).expect(403);
    const second = await grant(manager, userId, UNHELD).expect(403);

    expect([codeOf(first), codeOf(second)]).toEqual([
      ErrorCode.FORBIDDEN,
      ErrorCode.FORBIDDEN,
    ]);
    expect(await storedPermissions(userId)).toEqual(USER_BASE);
  });

  it('stores a held permission once when the grant is repeated', async () => {
    const manager = await grantingManager();
    const userId = await idOf(SEED_USER);
    await grant(manager, userId, HELD).expect(200);

    const repeated = await grant(manager, userId, HELD).expect(400);

    expect(codeOf(repeated)).toBe(ErrorCode.PERMISSION_ALREADY_EXISTS);
    expect(await storedPermissions(userId)).toEqual([...USER_BASE, HELD]);
  });

  it('refuses the wildcard from an actor who does not hold it', async () => {
    const manager = await grantingManager();
    const userId = await idOf(SEED_USER);

    await grant(manager, userId, '*').expect(400);

    expect(await storedPermissions(userId)).toEqual(USER_BASE);
  });

  it('refuses a list of permissions whole, a held one included', async () => {
    const manager = await grantingManager();
    const userId = await idOf(SEED_USER);

    await grant(manager, userId, [HELD, UNHELD]).expect(400);

    expect(await storedPermissions(userId)).toEqual(USER_BASE);
  });

  it('lets a wildcard holder grant a permission no role lists', async () => {
    const userId = await idOf(SEED_USER);
    const user = await loginAs(e2e.httpServer, SEED_USER);

    await grant(admin, userId, UNHELD).expect(200);

    expect(await storedPermissions(userId)).toEqual([...USER_BASE, UNHELD]);
    await user.get('/api/roles').expect(200);
  });

  it('refuses a grant to the actor itself, held or not', async () => {
    const manager = await grantingManager();
    const managerId = await idOf(SEED_MANAGER);
    const before = await storedPermissions(managerId);

    const held = await grant(manager, managerId, 'users:list:all').expect(400);
    const unheld = await grant(manager, managerId, UNHELD).expect(400);

    expect([codeOf(held), codeOf(unheld)]).toEqual([
      ErrorCode.CANNOT_MODIFY_SELF,
      ErrorCode.CANNOT_MODIFY_SELF,
    ]);
    expect(await storedPermissions(managerId)).toEqual(before);
    await manager.get('/api/roles').expect(403);
  });

  it('refuses a held permission for a peer and for a higher rank', async () => {
    const manager = await grantingManager();
    const { _id: peerId } = await e2e.state.accounts.createAccount({
      email: 'second-manager@seed.local',
      name: 'Second Manager',
      role: UserRole.MANAGER,
      isVerified: true,
    });
    const adminId = await idOf(SEED_ADMIN);

    const peer = await grant(manager, peerId, HELD).expect(403);
    const higher = await grant(manager, adminId, HELD).expect(403);

    expect([codeOf(peer), codeOf(higher)]).toEqual([
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    ]);
    expect(await storedPermissions(peerId)).toEqual([]);
    expect(await storedPermissions(adminId)).toEqual(['*']);
  });

  describe('removing a direct permission', () => {
    it('lets an actor remove a permission it does not hold from a lower rank', async () => {
      const manager = await grantingManager();
      const userId = await idOf(SEED_USER);
      await e2e.state.records.replaceAccountPermissions(userId, [UNHELD]);

      await revoke(manager, userId, UNHELD).expect(200);

      expect(await storedPermissions(userId)).toEqual([]);
    });

    it('refuses a removal from the actor itself and from a higher rank', async () => {
      const manager = await grantingManager();
      const managerId = await idOf(SEED_MANAGER);
      const adminId = await idOf(SEED_ADMIN);

      const own = await revoke(
        manager,
        managerId,
        'permissions:grant:all',
      ).expect(400);
      const higher = await revoke(manager, adminId, '*').expect(403);

      expect(codeOf(own)).toBe(ErrorCode.CANNOT_MODIFY_SELF);
      expect(codeOf(higher)).toBe(ErrorCode.CANNOT_MODIFY_HIGHER_ROLE);
      expect(await storedPermissions(managerId)).toEqual([
        'permissions:grant:all',
        'permissions:revoke:all',
      ]);
      expect(await storedPermissions(adminId)).toEqual(['*']);
    });

    it('answers 404 for a permission that is a lone percent sign', async () => {
      const userId = await idOf(SEED_USER);

      const missing = await admin
        .delete(`/api/admin/users/${userId}/permissions/%25`)
        .expect(404);

      expect(codeOf(missing)).toBe(ErrorCode.PERMISSION_NOT_FOUND);
      expect(await storedPermissions(userId)).toEqual(USER_BASE);
    });
  });

  describe('reading direct permissions', () => {
    it('needs the read permission and a target at or below the actor', async () => {
      const manager = await grantingManager();
      const userId = await idOf(SEED_USER);
      const path = `/api/admin/users/${userId}/permissions`;

      await manager.get(path).expect(403);

      await e2e.state.records.replaceAccountPermissions(
        await idOf(SEED_MANAGER),
        ['permissions:read:all'],
      );
      const read = await manager.get(path).expect(200);
      expect(
        (read.body as ApiBody<PermissionsResponse>).data.permissions,
      ).toEqual(USER_BASE);
      const higher = await manager
        .get(`/api/admin/users/${await idOf(SEED_ADMIN)}/permissions`)
        .expect(403);
      expect(codeOf(higher)).toBe(ErrorCode.CANNOT_MODIFY_HIGHER_ROLE);
    });
  });
});
