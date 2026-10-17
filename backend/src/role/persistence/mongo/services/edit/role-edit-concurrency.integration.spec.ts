import { Model, Types } from 'mongoose';
import { RoleService } from '../../../../role.service';
import { RoleEditService } from '../../../../services/edit/role-edit.service';
import { Role } from '../../schemas/role.schema';
import { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { SecurityEventDocument } from '../../../../../session/persistence/mongo/schemas/security-event.schema';
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
const THIRD_SLUG = 'content-chief';
const REVOKED_ACTION = 'sessions_revoked_all';
const CANDIDATE_SLUGS = [ROLE_SLUG, RENAMED_SLUG, THIRD_SLUG];

/**
 * Fifteen rounds of two renames racing unheld, each round its own
 * transactions and reruns. Slowest measured: 4.6 seconds.
 */
const FIFTEEN_RACES_CASE_MS = 10_000;

describe('role edit concurrency', () => {
  let actorId: string;
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: RoleEditHarness;
  let service: RoleService;
  let roleModel: Model<Role>;
  let events: Model<SecurityEventDocument>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootRoleEdit(mongo.uri('role_concurrency'));
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
      WEB_CLIENT_ID,
    );
    return { user, token: issued.sessionToken };
  }

  function beforeCommit(before: () => Promise<void>): jest.SpyInstance {
    const original = harness.edit.commit.bind(harness.edit);
    return jest
      .spyOn(harness.edit, 'commit')
      .mockImplementationOnce(
        async (...args: Parameters<RoleEditService['commit']>) => {
          await before();
          return original(...args);
        },
      );
  }

  async function storedRole(slug: string): Promise<Role | null> {
    return roleModel.findOne({ slug }).lean<Role | null>().exec();
  }

  async function storedUser(id: unknown): Promise<UserDocument | null> {
    return harness.users.findById(id).exec();
  }

  async function sessionAlive(token: string): Promise<boolean> {
    return (await harness.sessionService.validateSession(token)) !== null;
  }

  function revokedEventCount(user: UserDocument): Promise<number> {
    return events.countDocuments({
      targetUserId: user._id.toString(),
      action: REVOKED_ACTION,
    });
  }

  it('matches holders on the fresh slug when a rename landed before a permission edit', async () => {
    await seedRole();
    const holder = await seedHolder('s1@example.test');
    const spy = beforeCommit(async () => {
      await service.update(ROLE_SLUG, { name: 'Content Lead' }, actorId);
    });

    try {
      await service.update(
        ROLE_SLUG,
        {
          permissions: ['posts:read:all', 'users:delete:all'],
        },
        actorId,
      );
    } finally {
      spy.mockRestore();
    }

    expect((await storedRole(RENAMED_SLUG))?.permissions).toEqual([
      'posts:read:all',
      'users:delete:all',
    ]);
    expect((await storedUser(holder.user._id))?.role).toBe(RENAMED_SLUG);
    expect((await storedUser(holder.user._id))?.sessionVersion).toBe(2);
    expect(await revokedEventCount(holder.user)).toBe(2);
    expect(await sessionAlive(holder.token)).toBe(false);
  });

  it('revokes a session issued after the rename when a permission edit lands', async () => {
    await seedRole();
    const holder = await seedHolder('s1b@example.test');
    let fresh: string | undefined;
    const spy = beforeCommit(async () => {
      await service.update(ROLE_SLUG, { name: 'Content Lead' }, actorId);
      const issued = await harness.sessionService.createSession(
        holder.user._id,
        'agent',
        '127.0.0.1',
        WEB_CLIENT_ID,
      );
      fresh = issued.sessionToken;
    });

    try {
      await service.update(
        ROLE_SLUG,
        {
          permissions: ['posts:read:all', 'users:delete:all'],
        },
        actorId,
      );
    } finally {
      spy.mockRestore();
    }

    if (fresh === undefined) {
      throw new Error('expected a fresh session');
    }
    expect(await sessionAlive(fresh)).toBe(false);
    expect((await storedUser(holder.user._id))?.sessionVersion).toBe(2);
  });

  it('applies a second rename on top of a rename that landed first', async () => {
    await seedRole();
    const holder = await seedHolder('s2@example.test');
    const spy = beforeCommit(async () => {
      await service.update(ROLE_SLUG, { name: 'Content Lead' }, actorId);
    });

    let result: { slug: string } | undefined;
    try {
      result = await service.update(
        ROLE_SLUG,
        { name: 'Content Chief' },
        actorId,
      );
    } finally {
      spy.mockRestore();
    }

    expect(result?.slug).toBe(THIRD_SLUG);
    expect(await roleModel.findOne({ slug: RENAMED_SLUG })).toBeNull();
    expect((await storedUser(holder.user._id))?.role).toBe(THIRD_SLUG);
    expect(await roleModel.findOne({ slug: THIRD_SLUG })).not.toBeNull();
  });

  it(
    'never splits the role and its holders across two concurrent renames',
    async () => {
      for (let round = 0; round < 15; round += 1) {
        await harness.users.deleteMany({
          _id: { $ne: new Types.ObjectId(actorId) },
        });
        await roleModel.deleteMany({ slug: { $in: CANDIDATE_SLUGS } });
        await seedRole();
        const holder = await seedHolder(`s3-${round}@example.test`);

        const outcomes = await Promise.allSettled([
          service.update(ROLE_SLUG, { name: 'Content Lead' }, actorId),
          service.update(ROLE_SLUG, { name: 'Content Chief' }, actorId),
        ]);
        expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(
          true,
        );

        const stored = await storedUser(holder.user._id);
        const existing = await roleModel
          .find({ slug: { $in: CANDIDATE_SLUGS } })
          .lean();
        expect(existing).toHaveLength(1);
        expect(existing[0].slug).toBe(stored?.role);
      }
    },
    FIFTEEN_RACES_CASE_MS,
  );

  it('treats a duplicate permission entry as a change and signs holders out', async () => {
    await seedRole(['posts:read:all', 'users:delete:all']);
    const holder = await seedHolder('d1@example.test');

    const result = await service.update(
      ROLE_SLUG,
      {
        permissions: ['posts:read:all', 'posts:read:all'],
      },
      actorId,
    );

    expect(result.permissions).toEqual(['posts:read:all']);
    expect((await storedRole(ROLE_SLUG))?.permissions).toEqual([
      'posts:read:all',
    ]);
    expect(await sessionAlive(holder.token)).toBe(false);
    expect(await revokedEventCount(holder.user)).toBe(1);
  });
});
