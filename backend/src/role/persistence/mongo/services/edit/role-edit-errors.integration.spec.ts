import { ClientSessionOptions, Model, SaveOptions } from 'mongoose';
import { RoleService } from '../../../../role.service';
import { Role, RoleDocument } from '../../schemas/role.schema';
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

describe('role edit failures and retries', () => {
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

  it('keeps the role and its holders in agreement across a retried conflict', async () => {
    await seedRole();
    const holder = await seedHolder('retry@example.test');
    const original: (options?: SaveOptions) => Promise<RoleDocument> =
      roleModel.prototype.save;
    const spy = jest
      .spyOn(roleModel.prototype, 'save')
      .mockImplementationOnce(function (
        this: RoleDocument,
        ...args: unknown[]
      ) {
        return (async () => {
          const saved: Promise<RoleDocument> = Reflect.apply(
            original,
            this,
            args,
          );
          await harness.users.collection.updateOne(
            { _id: holder.user._id },
            { $inc: { issuanceFence: 1 } },
          );
          return saved;
        })();
      });

    try {
      const result = await service.update(
        ROLE_SLUG,
        { name: 'Content Lead' },
        actorId,
      );
      expect(result.slug).toBe(RENAMED_SLUG);
    } finally {
      spy.mockRestore();
    }

    expect((await storedRole(RENAMED_SLUG))?.name).toBe('Content Lead');
    expect(await roleModel.findOne({ slug: ROLE_SLUG })).toBeNull();
    expect((await storedUser(holder.user._id))?.role).toBe(RENAMED_SLUG);
    expect((await storedUser(holder.user._id))?.sessionVersion).toBe(1);
    expect(await revokedEventCount(holder.user)).toBe(1);
    expect(await sessionAlive(holder.token)).toBe(false);
  });

  it('answers a duplicate slug that appears mid-edit as ROLE_NAME_TAKEN', async () => {
    await seedRole();
    const original = harness.connection.startSession.bind(harness.connection);
    const spy = jest
      .spyOn(harness.connection, 'startSession')
      .mockImplementationOnce(async (options?: ClientSessionOptions) => {
        await roleModel.collection.insertOne({
          name: 'Content Lead',
          slug: RENAMED_SLUG,
          permissions: [],
        });
        return original(options);
      });

    try {
      await expect(
        service.update(ROLE_SLUG, { name: 'Content Lead' }, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.ROLE_NAME_TAKEN,
        status: 409,
      });
    } finally {
      spy.mockRestore();
    }

    expect((await storedRole(ROLE_SLUG))?.name).toBe('Content Editor');
  });

  it('answers a validation failure as a 400 field error, not 503', async () => {
    await seedRole();

    await expect(
      service.update(ROLE_SLUG, { name: '   ' }, actorId),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 400,
    });
  });
});
