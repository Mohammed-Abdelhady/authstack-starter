import { ClientSessionOptions } from 'mongoose';
import { UserRole } from '../../../../user/enums/user-role.enum';
import { startMemoryReplSet } from '../../../../../test/utils/memory-replset';
import {
  bootAdminAtomic,
  AdminAtomicHarness,
} from '../../../../../test/utils/admin/admin-atomic-harness';
import { TEST_NOW } from '../../../../../test/utils/frozen-clock';
import { RaceGate } from '../../../../../test/utils/race-gate';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/session-authority-harness';

export const EDITOR_SLUG = 'content-editor';
export const LEAD_SLUG = 'content-lead';
export const OLD_SLUG = 'old-role';
export const FRESH_SLUG = 'fresh-role';

export function useAdminRoundFour(database: string) {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: AdminAtomicHarness;
  let actorId: string;
  let roleActorId: string;
  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootAdminAtomic(mongo.uri(database));
    await harness.roleModel.init();
    await harness.users.init();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await harness?.app.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await harness.users.deleteMany({});
    await harness.sessions.deleteMany({});
    await harness.events.deleteMany({});
    await harness.grants.deleteMany({});
    await harness.roleModel.deleteMany({});
    await harness.roleModel.create([
      {
        name: 'Admin',
        slug: UserRole.ADMIN,
        level: 4,
        permissions: ['*'],
        isSystemRole: true,
        isProtected: true,
      },
      { name: 'Manager', slug: UserRole.MANAGER, level: 3, permissions: [] },
      { name: 'Support', slug: UserRole.SUPPORT, level: 2, permissions: [] },
      {
        name: 'User',
        slug: UserRole.USER,
        level: 1,
        permissions: [],
        isSystemRole: true,
        isProtected: true,
      },
      {
        name: 'Content Editor',
        slug: EDITOR_SLUG,
        permissions: ['posts:read:all'],
      },
      { name: 'Old Role', slug: OLD_SLUG, permissions: [] },
    ]);
    actorId = (
      await seed('round-four-admin@example.test', UserRole.ADMIN)
    )._id.toString();
    roleActorId = (
      await seed('round-four-role-admin@example.test', UserRole.ADMIN)
    )._id.toString();
  });
  afterEach(() => jest.restoreAllMocks());

  function seedRecord(email: string, role: string) {
    return {
      email,
      name: 'Target',
      role,
      isVerified: true,
      sessionVersion: 0,
    };
  }

  function seed(email: string, role: string = UserRole.USER) {
    return harness.users.create(seedRecord(email, role));
  }

  function seedMany(emails: readonly string[], role: string = UserRole.USER) {
    return harness.users.insertMany(
      emails.map((email) => seedRecord(email, role)),
    );
  }
  function assign(
    id: string,
    role = EDITOR_SLUG,
    actor = actorId,
    actorRole: string = UserRole.ADMIN,
  ) {
    return harness.service.updateUserRole(id, { role }, actor, actorRole);
  }
  function create(
    email: string,
    role = EDITOR_SLUG,
    actor = actorId,
    actorRole: string = UserRole.ADMIN,
  ) {
    return harness.createService.createUser(
      { email, name: 'Created', password: 'SecureP@ssw0rd', role },
      actorRole,
      actor,
    );
  }
  function beforeTransaction(before: () => Promise<void>) {
    const original = harness.connection.startSession.bind(harness.connection);
    return jest
      .spyOn(harness.connection, 'startSession')
      .mockImplementationOnce(async (options?: ClientSessionOptions) => {
        await before();
        return original(options);
      });
  }
  function holdReconcile(gate: RaceGate) {
    const original = harness.roleModel.collection.findOne.bind(
      harness.roleModel.collection,
    );
    let held = false;
    return jest
      .spyOn(harness.roleModel.collection, 'findOne')
      .mockImplementation(async (...args) => {
        if (!held && args[0]?._id && !args[1]?.session) {
          held = true;
          await gate.hold();
        }
        return original(...args);
      });
  }

  return {
    get h() {
      return harness;
    },
    get roleActorId() {
      return roleActorId;
    },
    get actorId() {
      return actorId;
    },
    seed,
    seedMany,
    assign,
    create,
    beforeTransaction,
    holdReconcile,
  };
}
