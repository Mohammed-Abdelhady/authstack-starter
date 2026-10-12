import { ClientSessionOptions, Types } from 'mongoose';
import { AdminUsersService } from '../../../../services/users/admin-users.service';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { WEB_CLIENT_ID } from '../../../../../session/constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../../../../session/constants/session-policy';
import { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { startMemoryReplSet } from '../../../../../../test/utils/memory-replset';
import { TEST_NOW } from '../../../../../../test/utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import {
  bootAdminAtomic,
  type AdminAtomicHarness,
} from '../../../../../../test/utils/admin/admin-atomic-harness';

const ADMIN_ROLE = 'admin';
const MANAGER_ROLE = 'manager';
const USER_ROLE = 'user';
const EDITOR_ROLE = 'content-editor';
const RENAMED_SLUG = 'content-lead';

describe('admin authorization races', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: AdminAtomicHarness;
  let service: AdminUsersService;
  let adminActorId: string;
  let secondAdminActorId: string;
  let managerActorId: string;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootAdminAtomic(mongo.uri('admin_races'));
    service = harness.service;
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.app.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await harness.sessions.deleteMany({});
    await harness.grants.deleteMany({});
    await harness.users.deleteMany({});
    await harness.roleModel.deleteMany({});
    await harness.events.deleteMany({});
    await harness.roleModel.create([
      {
        name: 'Admin',
        slug: ADMIN_ROLE,
        isSystemRole: true,
        isProtected: true,
        permissions: ['*'],
      },
      { name: 'Manager', slug: MANAGER_ROLE, permissions: [] },
      {
        name: 'User',
        slug: USER_ROLE,
        isSystemRole: true,
        isProtected: true,
        permissions: [],
      },
      {
        name: 'Content Editor',
        slug: EDITOR_ROLE,
        permissions: ['posts:read:all'],
      },
    ]);
    const [firstAdmin, secondAdmin, manager] = await harness.users.create([
      {
        email: 'actor-admin@example.test',
        name: 'Admin Actor',
        role: ADMIN_ROLE,
        isVerified: true,
        sessionVersion: 0,
      },
      {
        email: 'actor-admin-2@example.test',
        name: 'Admin Actor 2',
        role: ADMIN_ROLE,
        isVerified: true,
        sessionVersion: 0,
      },
      {
        email: 'actor-manager@example.test',
        name: 'Manager Actor',
        role: MANAGER_ROLE,
        isVerified: true,
        sessionVersion: 0,
      },
    ]);
    adminActorId = firstAdmin._id.toString();
    secondAdminActorId = secondAdmin._id.toString();
    managerActorId = manager._id.toString();
    await harness.applications.updateMany(
      { clientId: WEB_CLIENT_ID, environment: 'test' },
      {
        $set: {
          enabled: true,
          sessionVersion: 0,
          'policy.absoluteLifetimeMs': WEB_ABSOLUTE_LIFETIME_MS,
          'policy.idleLifetimeMs': WEB_IDLE_LIFETIME_MS,
        },
      },
    );
  });

  async function seedUser(
    email: string,
    role = USER_ROLE,
  ): Promise<UserDocument> {
    return harness.users.create({
      email,
      name: 'Target User',
      role,
      isVerified: true,
      sessionVersion: 0,
    });
  }

  function idOf(user: UserDocument): string {
    return user._id.toString();
  }

  async function storedUser(id: Types.ObjectId): Promise<UserDocument | null> {
    return harness.users.findById(id).exec();
  }

  function startSessionSpy(before: () => Promise<void>): jest.SpyInstance {
    const original = harness.connection.startSession.bind(harness.connection);
    return jest
      .spyOn(harness.connection, 'startSession')
      .mockImplementationOnce(async (options?: ClientSessionOptions) => {
        await before();
        return original(options);
      });
  }

  it('lets one of two racing admins win without losing a revocation', async () => {
    const firstRole = 'role-a';
    const secondRole = 'role-b';
    await harness.roleModel.create([
      { name: 'Role A', slug: firstRole, permissions: [] },
      { name: 'Role B', slug: secondRole, permissions: [] },
    ]);
    const user = await seedUser('race@example.test');

    const results = await Promise.allSettled([
      service.updateUserRole(
        idOf(user),
        { role: firstRole },
        adminActorId,
        ADMIN_ROLE,
      ),
      service.updateUserRole(
        idOf(user),
        { role: secondRole },
        secondAdminActorId,
        ADMIN_ROLE,
      ),
    ]);

    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const stored = await storedUser(user._id);
    expect([firstRole, secondRole]).toContain(stored?.role);
    // Every committed revocation bumped the version and recorded one event.
    const events = await harness.events.countDocuments({
      targetUserId: idOf(user),
      action: 'sessions_revoked_all',
    });
    expect(stored?.sessionVersion).toBe(events);
    expect(stored?.sessionVersion).toBeGreaterThanOrEqual(1);
  });

  it('refuses a stale lower-actor deactivate after a promotion lands', async () => {
    const target = await seedUser('stale@example.test');
    const spy = startSessionSpy(async () => {
      await harness.users.collection.updateOne(
        { _id: target._id },
        { $set: { role: ADMIN_ROLE } },
      );
    });

    try {
      await expect(
        service.updateUserStatus(
          idOf(target),
          { isActive: false },
          managerActorId,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    } finally {
      spy.mockRestore();
    }

    const stored = await storedUser(target._id);
    expect(stored?.role).toBe(ADMIN_ROLE);
    expect(stored?.isDeleted).toBe(false);
  });

  it('refuses an assignment when the role is renamed before the transaction', async () => {
    const target = await seedUser('dead-slug@example.test');
    const spy = startSessionSpy(async () => {
      await harness.roleModel.collection.updateOne(
        { slug: EDITOR_ROLE },
        { $set: { slug: RENAMED_SLUG } },
      );
    });

    try {
      await expect(
        service.updateUserRole(
          idOf(target),
          { role: EDITOR_ROLE },
          adminActorId,
          ADMIN_ROLE,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_NOT_FOUND });
    } finally {
      spy.mockRestore();
    }

    expect((await storedUser(target._id))?.role).toBe(USER_ROLE);
    expect(
      await harness.roleModel.findOne({ slug: RENAMED_SLUG }),
    ).not.toBeNull();
  });
});
