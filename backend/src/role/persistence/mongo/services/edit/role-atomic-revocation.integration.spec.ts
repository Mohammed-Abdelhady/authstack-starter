import { Model } from 'mongoose';
import { MongoNetworkError } from 'mongodb';
import { RoleService } from '../../../../role.service';
import { Role } from '../../schemas/role.schema';
import { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { SecurityEventDocument } from '../../../../../session/persistence/mongo/schemas/security-event.schema';
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
  bootRoleEdit,
  type RoleEditHarness,
} from '../../../../../../test/utils/role/role-edit-harness';

const ROLE_SLUG = 'content-editor';
const RENAMED_SLUG = 'content-lead';
const REVOKED_ACTION = 'sessions_revoked_all';
const NEVER_REVOKED = 0;

describe('role edits end affected sessions atomically', () => {
  let actorId: string;
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: RoleEditHarness;
  let service: RoleService;
  let roleModel: Model<Role>;
  let events: Model<SecurityEventDocument>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootRoleEdit(mongo.uri('role_atomic'));
    service = harness.service;
    roleModel = harness.roleModel;
    events = harness.events;
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
    await roleModel.deleteMany({});
    await events.deleteMany({});
    await roleModel.create({
      name: 'Admin',
      slug: 'admin',
      permissions: ['*'],
      isSystemRole: true,
      isProtected: true,
    });
    actorId = (
      await harness.users.create({
        email: 'role-admin@example.test',
        name: 'Admin',
        role: 'admin',
        isVerified: true,
      })
    )._id.toString();
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

  async function seedRole(permissions = ['posts:read:all']): Promise<void> {
    await roleModel.create({
      name: 'Content Editor',
      slug: ROLE_SLUG,
      permissions,
    });
  }

  async function seedHolder(
    email: string,
  ): Promise<{ user: UserDocument; token: string }> {
    const user = await harness.users.create({
      email,
      name: 'Holder',
      role: ROLE_SLUG,
      isVerified: true,
      sessionVersion: 0,
    });
    const issued = await harness.sessionService.createSession(
      user._id,
      'agent',
      '127.0.0.1',
    );
    return { user, token: issued.sessionToken };
  }

  async function sessionAlive(token: string): Promise<boolean> {
    return (await harness.sessionService.validateSession(token)) !== null;
  }

  async function storedRole(slug: string): Promise<Role | null> {
    return roleModel.findOne({ slug }).lean<Role | null>().exec();
  }

  async function storedUser(id: unknown): Promise<UserDocument | null> {
    return harness.users.findById(id).exec();
  }

  function revokedEventCount(user: UserDocument): Promise<number> {
    return events.countDocuments({
      targetUserId: user._id.toString(),
      action: REVOKED_ACTION,
    });
  }

  it('renames the role, moves holders and ends their sessions', async () => {
    await seedRole();
    const first = await seedHolder('rename-a@example.test');
    const second = await seedHolder('rename-b@example.test');

    const result = await service.update(
      ROLE_SLUG,
      { name: 'Content Lead' },
      actorId,
    );

    expect(result.slug).toBe(RENAMED_SLUG);
    expect(result.usersMoved).toBe(2);
    expect((await storedUser(first.user._id))?.role).toBe(RENAMED_SLUG);
    expect((await storedUser(second.user._id))?.role).toBe(RENAMED_SLUG);
    expect(await sessionAlive(first.token)).toBe(false);
    expect(await sessionAlive(second.token)).toBe(false);
    expect(await revokedEventCount(first.user)).toBe(1);
    expect(await revokedEventCount(second.user)).toBe(1);
  });

  it('edits the permissions and ends every holder session', async () => {
    await seedRole();
    const holder = await seedHolder('permissions@example.test');

    const result = await service.update(
      ROLE_SLUG,
      {
        permissions: ['posts:read:all', 'posts:write:all'],
      },
      actorId,
    );

    expect(result.usersMoved).toBe(0);
    expect((await storedRole(ROLE_SLUG))?.permissions).toEqual([
      'posts:read:all',
      'posts:write:all',
    ]);
    expect((await storedUser(holder.user._id))?.role).toBe(ROLE_SLUG);
    expect(await sessionAlive(holder.token)).toBe(false);
    expect(await revokedEventCount(holder.user)).toBe(1);
  });

  it('does not end sessions when the permission set is unchanged', async () => {
    await seedRole();
    const holder = await seedHolder('same-permissions@example.test');

    const result = await service.update(
      ROLE_SLUG,
      {
        permissions: ['posts:read:all'],
      },
      actorId,
    );

    expect(result.usersMoved).toBe(0);
    expect((await storedUser(holder.user._id))?.sessionVersion).toBe(
      NEVER_REVOKED,
    );
    expect(await sessionAlive(holder.token)).toBe(true);
  });

  it('leaves the role and holders untouched when the revocation fails', async () => {
    await seedRole();
    const holder = await seedHolder('revoke-fail@example.test');
    const spy = jest
      .spyOn(harness.users, 'updateMany')
      .mockImplementationOnce(() => {
        throw new MongoNetworkError('user store unavailable');
      });

    try {
      await expect(
        service.update(ROLE_SLUG, { name: 'Content Lead' }, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTHORITY_UNAVAILABLE,
        status: 503,
      });
    } finally {
      spy.mockRestore();
    }

    expect((await storedRole(ROLE_SLUG))?.slug).toBe(ROLE_SLUG);
    expect((await storedUser(holder.user._id))?.role).toBe(ROLE_SLUG);
    expect((await storedUser(holder.user._id))?.sessionVersion).toBe(
      NEVER_REVOKED,
    );
    expect(await sessionAlive(holder.token)).toBe(true);
  });

  it('rolls back the role and the move when a later write fails', async () => {
    await seedRole();
    const holder = await seedHolder('event-fail@example.test');
    const spy = jest.spyOn(events, 'insertMany').mockImplementationOnce(() => {
      throw new MongoNetworkError('event store unavailable');
    });

    try {
      await expect(
        service.update(ROLE_SLUG, { name: 'Content Lead' }, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTHORITY_UNAVAILABLE,
        status: 503,
      });
    } finally {
      spy.mockRestore();
    }

    expect((await storedRole(ROLE_SLUG))?.slug).toBe(ROLE_SLUG);
    expect((await storedUser(holder.user._id))?.role).toBe(ROLE_SLUG);
    expect((await storedUser(holder.user._id))?.sessionVersion).toBe(
      NEVER_REVOKED,
    );
    expect(await sessionAlive(holder.token)).toBe(true);
  });

  it('renames a role that has no holders', async () => {
    await seedRole();

    const result = await service.update(
      ROLE_SLUG,
      { name: 'Content Lead' },
      actorId,
    );

    expect(result.slug).toBe(RENAMED_SLUG);
    expect(result.usersMoved).toBe(0);
    expect((await storedRole(RENAMED_SLUG))?.name).toBe('Content Lead');
  });

  it('leaves a description-only edit out of the session path', async () => {
    await seedRole();
    const holder = await seedHolder('description@example.test');

    const result = await service.update(
      ROLE_SLUG,
      {
        description: 'Writes and edits posts',
      },
      actorId,
    );

    expect(result.usersMoved).toBe(0);
    expect((await storedRole(ROLE_SLUG))?.description).toBe(
      'Writes and edits posts',
    );
    expect(await sessionAlive(holder.token)).toBe(true);
  });
});
