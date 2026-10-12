import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import {
  PERMISSION_PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_PERMISSIONS,
} from '../../../../../common/constants/permissions';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import {
  MongoUnitOfWorkRunner,
  mongoSessionOf,
} from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import { useAdminRoundFour } from '../admin-round-four.harness-spec';

const GRANTED_PERMISSION = 'posts:write:all';

describe('a grant uses authority current at commit', () => {
  const fixture = useAdminRoundFour('grant_authority_races');

  it('does not create a role after the actor loses its direct grant', async () => {
    const { h } = fixture;
    const actor = await fixture.seed('manager@example.test', UserRole.MANAGER);
    await h.users.updateOne(
      { _id: actor._id },
      {
        $set: {
          permissions: [ROLE_PERMISSIONS.CREATE_ALL, GRANTED_PERMISSION],
        },
      },
    );
    const gate = new RaceGate();
    const original = h.users.collection.updateOne.bind(h.users.collection);
    let held = false;
    jest
      .spyOn(h.users.collection, 'updateOne')
      .mockImplementation(async (...args) => {
        if (
          !held &&
          !Array.isArray(args[1]) &&
          args[1]?.$inc?.grantAuthorityFence === 1
        ) {
          held = true;
          await gate.hold();
        }
        return original(...args);
      });

    const creation = h.roles.create(
      { name: 'New Writer', permissions: [GRANTED_PERMISSION] },
      actor._id.toString(),
    );
    try {
      await gate.reached();
      await h.users.updateOne(
        { _id: actor._id },
        { $set: { permissions: [ROLE_PERMISSIONS.CREATE_ALL] } },
      );
    } finally {
      gate.release();
    }
    await expect(creation).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      status: 403,
    });
    expect(await h.roleModel.findOne({ slug: 'new-writer' })).toBeNull();
  });

  it('does not grant a direct permission after another admin revokes it from the actor', async () => {
    const { h } = fixture;
    const actor = await fixture.seed('manager@example.test', UserRole.MANAGER);
    const target = await fixture.seed('recipient@example.test');
    await h.users.updateOne(
      { _id: actor._id },
      {
        $set: {
          permissions: [PERMISSION_PERMISSIONS.GRANT_ALL, GRANTED_PERMISSION],
        },
      },
    );
    const gate = new RaceGate();
    const original = h.users.collection.updateOne.bind(h.users.collection);
    let held = false;
    jest
      .spyOn(h.users.collection, 'updateOne')
      .mockImplementation(async (...args) => {
        if (
          !held &&
          !Array.isArray(args[1]) &&
          args[1]?.$inc?.grantAuthorityFence === 1
        ) {
          held = true;
          await gate.hold();
        }
        return original(...args);
      });

    const grant = h.permissions.addPermission(
      target._id.toString(),
      GRANTED_PERMISSION,
      actor._id.toString(),
      UserRole.MANAGER,
    );
    try {
      await gate.reached();
      await h.permissions.removePermission(
        actor._id.toString(),
        GRANTED_PERMISSION,
        fixture.actorId,
        UserRole.ADMIN,
      );
    } finally {
      gate.release();
    }
    await expect(grant).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      status: 403,
    });
    expect((await h.users.findById(target._id))?.permissions).not.toContain(
      GRANTED_PERMISSION,
    );
  });

  it('does not assign a role after that role gains a permission the actor lacks', async () => {
    const { h } = fixture;
    await h.roleModel.updateOne(
      { slug: UserRole.SUPPORT },
      { $set: { permissions: ['posts:read:all'] } },
    );
    const actor = await fixture.seed('manager@example.test', UserRole.MANAGER);
    const target = await fixture.seed('target@example.test');
    await h.users.updateOne(
      { _id: actor._id },
      {
        $set: { permissions: [USER_PERMISSIONS.UPDATE_ALL, 'posts:read:all'] },
      },
    );
    const gate = new RaceGate();
    const original = h.roleModel.collection.findOneAndUpdate.bind(
      h.roleModel.collection,
    );
    let held = false;
    jest
      .spyOn(h.roleModel.collection, 'findOneAndUpdate')
      .mockImplementation(async (...args) => {
        if (
          !held &&
          args[0]?.slug === UserRole.SUPPORT &&
          !Array.isArray(args[1]) &&
          args[1]?.$inc?.grantAuthorityFence === 1
        ) {
          held = true;
          await gate.hold();
        }
        return original(...args);
      });

    const assignment = fixture.assign(
      target._id.toString(),
      UserRole.SUPPORT,
      actor._id.toString(),
      UserRole.MANAGER,
    );
    try {
      await gate.reached();
      await h.roles.update(
        UserRole.SUPPORT,
        { permissions: ['posts:read:all', GRANTED_PERMISSION] },
        fixture.actorId,
      );
    } finally {
      gate.release();
    }
    await expect(assignment).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      status: 403,
    });
    expect((await h.users.findById(target._id))?.role).toBe(UserRole.USER);
  });

  it('lets unrelated authority keys progress while one transaction is held', async () => {
    const { h } = fixture;
    const runner = new MongoUnitOfWorkRunner(h.connection);
    const gate = new RaceGate();
    const first = runner.runForAuthority('first-actor', async (work) => {
      await h.users.collection.insertOne(
        {
          email: 'first-grant@example.test',
          name: 'First',
          role: UserRole.USER,
        },
        { session: mongoSessionOf(work) },
      );
      await gate.hold();
    });
    try {
      await gate.reached();
      await runner.runForAuthority('second-actor', async (work) => {
        await h.users.collection.insertOne(
          {
            email: 'second-grant@example.test',
            name: 'Second',
            role: UserRole.USER,
          },
          { session: mongoSessionOf(work) },
        );
      });
      expect(
        await h.users.findOne({ email: 'second-grant@example.test' }),
      ).not.toBeNull();
      expect(
        await h.users.findOne({ email: 'first-grant@example.test' }),
      ).toBeNull();
    } finally {
      gate.release();
      await first;
    }
    expect(
      await h.users.findOne({ email: 'first-grant@example.test' }),
    ).not.toBeNull();
  });

  it('releases an authority key after a failed transaction', async () => {
    const { h } = fixture;
    const runner = new MongoUnitOfWorkRunner(h.connection);
    const failed = new Error('refused work');
    await expect(
      runner.runForAuthority('same-actor', () => Promise.reject(failed)),
    ).rejects.toBe(failed);
    await runner.runForAuthority('same-actor', async (work) => {
      await h.users.collection.insertOne(
        {
          email: 'after-refusal@example.test',
          name: 'After',
          role: UserRole.USER,
        },
        { session: mongoSessionOf(work) },
      );
    });
    expect(
      await h.users.findOne({ email: 'after-refusal@example.test' }),
    ).not.toBeNull();
  });

  it('refuses a role grant when the actor role is gone', async () => {
    const { h } = fixture;
    const actor = await fixture.seed('orphan@example.test', UserRole.MANAGER);
    await h.users.updateOne(
      { _id: actor._id },
      {
        $set: {
          permissions: [ROLE_PERMISSIONS.CREATE_ALL, GRANTED_PERMISSION],
        },
      },
    );
    await h.roleModel.deleteOne({ slug: UserRole.MANAGER });
    await expect(
      h.roles.create(
        { name: 'Orphan Grant', permissions: [GRANTED_PERMISSION] },
        actor._id.toString(),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID, status: 401 });
    expect(await h.roleModel.findOne({ slug: 'orphan-grant' })).toBeNull();
  });
  it('keeps business update timestamps unchanged while fencing grant authority', async () => {
    const { h } = fixture;
    const originalTime = new Date('2001-02-03T04:05:06.000Z');
    await h.users.updateOne(
      { _id: fixture.actorId },
      { $set: { updatedAt: originalTime } },
      { timestamps: false },
    );
    await h.roleModel.updateOne(
      { slug: UserRole.ADMIN },
      { $set: { updatedAt: originalTime } },
      { timestamps: false },
    );
    await h.roles.create(
      { name: 'Timestamp Safe Role', permissions: [] },
      fixture.actorId,
    );
    const database = h.connection.db;
    if (!database) throw new Error('Mongo fixture has no database');
    const actor = await database
      .collection<{ updatedAt: Date }>('users')
      .findOne({ email: 'round-four-admin@example.test' });
    const authorityRole = await database
      .collection<{ updatedAt: Date }>('roles')
      .findOne({ slug: UserRole.ADMIN });
    expect(actor?.updatedAt.toISOString()).toBe('2001-02-03T04:05:06.000Z');
    expect(authorityRole?.updatedAt.toISOString()).toBe(
      '2001-02-03T04:05:06.000Z',
    );
    expect(
      await h.roleModel.countDocuments({ slug: 'timestamp-safe-role' }),
    ).toBe(1);
  });
});
