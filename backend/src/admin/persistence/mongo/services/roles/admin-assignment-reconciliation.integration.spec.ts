import { ClientSessionOptions, Types } from 'mongoose';
import { AdminUsersService } from '../../../../services/users/admin-users.service';
import { AdminUserCreateService } from '../../../../services/users/admin-user-create.service';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { WEB_CLIENT_ID } from '../../../../../session/constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../../../../session/constants/session-policy';
import { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { RoleDocument } from '../../../../../role/persistence/mongo/schemas/role.schema';
import { startMemoryReplSet } from '../../../../../../test/utils/memory-replset';
import { TEST_NOW } from '../../../../../../test/utils/frozen-clock';
import { RaceGate } from '../../../../../../test/utils/race-gate';
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

describe('admin role assignment reconciliation', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: AdminAtomicHarness;
  let service: AdminUsersService;
  let createService: AdminUserCreateService;
  let adminActorId: string;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootAdminAtomic(mongo.uri('admin_reconcile'));
    service = harness.service;
    createService = harness.createService;
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
    const adminActor = await harness.users.create({
      email: 'reconcile-admin@example.test',
      name: 'Admin Actor',
      role: ADMIN_ROLE,
      isVerified: true,
      sessionVersion: 0,
    });
    adminActorId = adminActor._id.toString();
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

  async function editorRole(): Promise<RoleDocument | null> {
    return harness.roleModel.findOne({ slug: EDITOR_ROLE }).exec();
  }

  function holdReconcile(
    roleId: Types.ObjectId,
    gate: RaceGate,
  ): jest.SpyInstance {
    const original = harness.roleModel.collection.findOne.bind(
      harness.roleModel.collection,
    );
    let held = false;
    return jest
      .spyOn(harness.roleModel.collection, 'findOne')
      .mockImplementation(async (...args) => {
        if (
          !held &&
          !args[1]?.session &&
          args[0]?._id instanceof Types.ObjectId &&
          args[0]._id.equals(roleId)
        ) {
          held = true;
          await gate.hold();
        }
        return original(...args);
      });
  }

  async function reachReconcile(gate: RaceGate, request: Promise<unknown>) {
    const reached = await Promise.race([
      gate.reached().then(() => true),
      request.then(
        () => false,
        () => false,
      ),
    ]);
    if (!reached) throw new Error('request did not reach reconciliation');
  }

  function beforeNextTransaction(
    before: () => Promise<void>,
  ): jest.SpyInstance {
    const original = harness.connection.startSession.bind(harness.connection);
    return jest
      .spyOn(harness.connection, 'startSession')
      .mockImplementationOnce(async (options?: ClientSessionOptions) => {
        await before();
        return original(options);
      });
  }

  it('repairs the assigned slug when a rename lands during the assignment', async () => {
    const target = await seedUser('assign-rename@example.test');
    const role = await editorRole();
    if (!role) {
      throw new Error('expected the content-editor role');
    }
    const gate = new RaceGate();
    const spy = holdReconcile(role._id, gate);
    const request = service.updateUserRole(
      idOf(target),
      { role: EDITOR_ROLE },
      adminActorId,
      ADMIN_ROLE,
    );

    try {
      await reachReconcile(gate, request);
      await harness.roleModel.collection.updateOne(
        { _id: role._id },
        { $set: { slug: RENAMED_SLUG } },
      );
    } finally {
      gate.release();
      await Promise.allSettled([request]);
      spy.mockRestore();
    }
    await request;

    expect((await storedUser(target._id))?.role).toBe(RENAMED_SLUG);
    expect(
      await harness.roleModel.findOne({ slug: RENAMED_SLUG }),
    ).not.toBeNull();
  });

  it('restores the previous role and answers ROLE_NOT_FOUND when a delete lands', async () => {
    const target = await seedUser('assign-delete@example.test');
    const role = await editorRole();
    if (!role) {
      throw new Error('expected the content-editor role');
    }
    const gate = new RaceGate();
    const spy = holdReconcile(role._id, gate);
    const request = service.updateUserRole(
      idOf(target),
      { role: EDITOR_ROLE },
      adminActorId,
      ADMIN_ROLE,
    );

    try {
      await reachReconcile(gate, request);
      await harness.roleModel.collection.deleteOne({ _id: role._id });
    } finally {
      gate.release();
      await Promise.allSettled([request]);
      spy.mockRestore();
    }
    await expect(request).rejects.toMatchObject({
      code: ErrorCode.ROLE_NOT_FOUND,
    });

    expect((await storedUser(target._id))?.role).toBe(USER_ROLE);
    expect(await harness.roleModel.findOne({ slug: USER_ROLE })).not.toBeNull();
  });

  it('repairs the slug of an account created while a rename lands', async () => {
    const role = await editorRole();
    if (!role) {
      throw new Error('expected the content-editor role');
    }
    const gate = new RaceGate();
    const spy = holdReconcile(role._id, gate);
    const request = createService.createUser(
      {
        email: 'created-mid-rename@example.test',
        name: 'Created',
        password: 'SecureP@ssw0rd',
        role: EDITOR_ROLE,
      },
      ADMIN_ROLE,
      adminActorId,
    );

    try {
      await reachReconcile(gate, request);
      await harness.roleModel.collection.updateOne(
        { _id: role._id },
        { $set: { slug: RENAMED_SLUG } },
      );
    } finally {
      gate.release();
      await Promise.allSettled([request]);
      spy.mockRestore();
    }
    await request;

    const created = await harness.users
      .findOne({ email: 'created-mid-rename@example.test' })
      .exec();
    expect(created?.role).toBe(RENAMED_SLUG);
  });

  it('refuses when the actor was demoted and deactivated before the transaction', async () => {
    const actor = await seedUser('demoted-actor@example.test', MANAGER_ROLE);
    const target = await seedUser('demoted-target@example.test');
    const spy = beforeNextTransaction(async () => {
      await harness.users.collection.updateOne(
        { _id: actor._id },
        { $set: { role: USER_ROLE, isDeleted: true } },
      );
    });

    try {
      await expect(
        service.updateUserStatus(
          idOf(target),
          { isActive: false },
          idOf(actor),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });
    } finally {
      spy.mockRestore();
    }

    expect((await storedUser(target._id))?.isDeleted).toBe(false);
  });

  it('refuses when the actor was demoted below the target before the transaction', async () => {
    const actor = await seedUser('demoted-rank@example.test', MANAGER_ROLE);
    const target = await seedUser('rank-target@example.test');
    const spy = beforeNextTransaction(async () => {
      await harness.users.collection.updateOne(
        { _id: actor._id },
        { $set: { role: USER_ROLE } },
      );
    });

    try {
      await expect(
        service.updateUserStatus(
          idOf(target),
          { isActive: false },
          idOf(actor),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    } finally {
      spy.mockRestore();
    }

    expect((await storedUser(target._id))?.isDeleted).toBe(false);
  });

  it('refuses to delete a role a user still holds', async () => {
    await seedUser('holder@example.test', EDITOR_ROLE);

    await expect(
      harness.roles.delete(EDITOR_ROLE, adminActorId),
    ).rejects.toMatchObject({
      code: ErrorCode.ROLE_HAS_USERS,
      status: 400,
    });
    expect(await editorRole()).not.toBeNull();
  });
});
