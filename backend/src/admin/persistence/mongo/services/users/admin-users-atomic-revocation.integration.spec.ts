import { Types } from 'mongoose';
import { MongoNetworkError } from 'mongodb';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import { AdminUsersService } from '../../../../services/users/admin-users.service';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { WEB_CLIENT_ID } from '../../../../../session/constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../../../../session/constants/session-policy';
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
import { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';

const ADMIN_ROLE = 'admin';
const USER_ROLE = 'user';
const NEXT_ROLE = 'content-editor';
const NEVER_SAVED = 0;

describe('admin changes end sessions atomically', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: AdminAtomicHarness;
  let service: AdminUsersService;
  let actorId: string;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootAdminAtomic(mongo.uri('admin_atomic'));
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
      { name: 'Manager', slug: 'manager', permissions: [] },
      {
        name: 'User',
        slug: USER_ROLE,
        isSystemRole: true,
        isProtected: true,
        permissions: [],
      },
      {
        name: 'Content Editor',
        slug: NEXT_ROLE,
        permissions: ['posts:read:all'],
      },
    ]);
    const actor = await harness.users.create({
      email: 'actor@example.test',
      name: 'Actor',
      role: ADMIN_ROLE,
      isVerified: true,
      sessionVersion: 0,
    });
    actorId = actor._id.toString();
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

  async function seedUser(email: string): Promise<UserDocument> {
    return harness.users.create({
      email,
      name: 'Target User',
      role: USER_ROLE,
      isVerified: true,
      sessionVersion: 0,
    });
  }

  function login(user: UserDocument): Promise<{ sessionToken: string }> {
    return harness.sessionService.createSession(user._id, 'agent', '127.0.0.1');
  }

  async function storedUser(id: Types.ObjectId): Promise<UserDocument | null> {
    return harness.users.findById(id).exec();
  }

  async function sessionAlive(token: string): Promise<boolean> {
    return (await harness.sessionService.validateSession(token)) !== null;
  }

  function idOf(user: UserDocument): string {
    return user._id.toString();
  }

  interface Operation {
    label: string;
    run: (id: string) => Promise<unknown>;
    saved: (user: UserDocument | null) => boolean;
  }

  const OPS: Operation[] = [
    {
      label: 'role change',
      run: (id) =>
        service.updateUserRole(id, { role: NEXT_ROLE }, actorId, ADMIN_ROLE),
      saved: (user) => user?.role === NEXT_ROLE,
    },
    {
      label: 'deactivate',
      run: (id) => service.updateUserStatus(id, { isActive: false }, actorId),
      saved: (user) => user?.isDeleted === true,
    },
    {
      label: 'delete',
      run: (id) => service.deleteUser(id, actorId),
      saved: (user) => user?.isDeleted === true,
    },
  ];

  it.each(OPS)(
    '$label: saves and ends every session',
    async ({ run, saved }) => {
      const user = await seedUser('success@example.test');
      const first = await login(user);
      const second = await login(user);

      await run(idOf(user));

      expect(saved(await storedUser(user._id))).toBe(true);
      expect(await sessionAlive(first.sessionToken)).toBe(false);
      expect(await sessionAlive(second.sessionToken)).toBe(false);
    },
  );

  it.each(OPS)(
    '$label: a failed revocation changes nothing',
    async ({ run, saved }) => {
      const user = await seedUser('revoke-fail@example.test');
      const session = await login(user);
      const spy = jest
        .spyOn(harness.sessions, 'countDocuments')
        .mockImplementationOnce(() => {
          throw new MongoNetworkError('session store unavailable');
        });

      try {
        await expect(run(idOf(user))).rejects.toMatchObject({
          code: ErrorCode.AUTHORITY_UNAVAILABLE,
          status: 503,
        });
      } finally {
        spy.mockRestore();
      }

      const stored = await storedUser(user._id);
      expect(saved(stored)).toBe(false);
      expect(stored?.sessionVersion).toBe(NEVER_SAVED);
      expect(await sessionAlive(session.sessionToken)).toBe(true);
    },
  );

  it.each(OPS)(
    '$label: a failed later write rolls back the save',
    async ({ run, saved }) => {
      const user = await seedUser('later-fail@example.test');
      const session = await login(user);
      const spy = jest
        .spyOn(harness.events, 'create')
        .mockImplementationOnce(() => {
          throw new MongoNetworkError('event store unavailable');
        });

      try {
        await expect(run(idOf(user))).rejects.toMatchObject({
          code: ErrorCode.AUTHORITY_UNAVAILABLE,
          status: 503,
        });
      } finally {
        spy.mockRestore();
      }

      const stored = await storedUser(user._id);
      expect(saved(stored)).toBe(false);
      expect(stored?.sessionVersion).toBe(NEVER_SAVED);
      expect(await sessionAlive(session.sessionToken)).toBe(true);
    },
  );

  it.each(OPS)(
    '$label: still works when the target has no sessions',
    async ({ run, saved }) => {
      const user = await seedUser('no-sessions@example.test');

      await run(idOf(user));

      const stored = await storedUser(user._id);
      expect(saved(stored)).toBe(true);
      expect(stored?.sessionVersion).toBe(1);
    },
  );

  it('refuses an operation on the actor own account and changes nothing', async () => {
    const user = await seedUser('self@example.test');
    const session = await login(user);

    await expect(
      service.deleteUser(idOf(user), idOf(user)),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_SELF });

    expect((await storedUser(user._id))?.isDeleted).toBe(false);
    expect(await sessionAlive(session.sessionToken)).toBe(true);
  });

  it('refuses an operation on a higher role and changes nothing', async () => {
    const target = await harness.users.create({
      email: 'higher@example.test',
      name: 'Target User',
      role: ADMIN_ROLE,
      isVerified: true,
      sessionVersion: 0,
    });
    const session = await login(target);

    await expect(
      service.updateUserRole(
        idOf(target),
        { role: USER_ROLE },
        actorId,
        USER_ROLE,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });

    expect((await storedUser(target._id))?.role).toBe(ADMIN_ROLE);
    expect(await sessionAlive(session.sessionToken)).toBe(true);
  });

  it('marks an admin-forced sign-out with the actor and reason', async () => {
    const user = await seedUser('actor-event@example.test');
    await login(user);

    await service.deleteUser(idOf(user), actorId);

    const event = await harness.events
      .findOne({ targetUserId: idOf(user), action: 'sessions_revoked_all' })
      .lean()
      .exec();
    expect(event?.actorId).toBe(actorId);
    expect(event?.reasonCode).toBe(REVOKED_REASON.ADMIN_FORCED);
  });
});
