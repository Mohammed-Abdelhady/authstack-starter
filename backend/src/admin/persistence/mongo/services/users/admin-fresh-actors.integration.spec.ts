import { Types } from 'mongoose';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import { ROLE_PERMISSIONS } from '../../../../../common/constants/permissions';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

const ADMIN_CALLS = ['assignment', 'creation'] as const;
const ROLE_EDITS = ['rename', 'permissions', 'description', 'delete'] as const;
const ACTOR_CHANGES = ['demoted', 'deleted', 'missing'] as const;

describe('fresh actors authorize administrative transactions', () => {
  const fixture = useAdminRoundFour('round_four_actors');

  for (const call of ADMIN_CALLS) {
    it(`rejects ${call} of support by a manager who was demoted to support`, async () => {
      const { h } = fixture;
      const actor = await fixture.seed(
        'manager@example.test',
        UserRole.MANAGER,
      );
      const target = await fixture.seed('target@example.test');
      fixture.beforeTransaction(async () => {
        await h.users.collection.updateOne(
          { _id: actor._id },
          { $set: { role: UserRole.SUPPORT } },
        );
      });
      await expect(
        call === 'assignment'
          ? fixture.assign(
              target._id.toString(),
              UserRole.SUPPORT,
              actor._id.toString(),
              UserRole.MANAGER,
            )
          : fixture.create(
              'new@example.test',
              UserRole.SUPPORT,
              actor._id.toString(),
              UserRole.MANAGER,
            ),
      ).rejects.toMatchObject({
        code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
        status: 403,
      });
      expect((await h.users.findById(target._id))?.role).toBe(UserRole.USER);
      expect(await h.users.findOne({ email: 'new@example.test' })).toBeNull();
      expect(await h.events.countDocuments({})).toBe(0);
    });
  }

  for (const change of ['deleted', 'missing'] as const) {
    it(`rejects creation after its actor is ${change}`, async () => {
      const { h } = fixture;
      fixture.beforeTransaction(async () => {
        if (change === 'missing') {
          await h.users.collection.deleteOne({
            _id: new Types.ObjectId(fixture.actorId),
          });
        } else {
          await h.users.collection.updateOne(
            { _id: new Types.ObjectId(fixture.actorId) },
            { $set: { isDeleted: true } },
          );
        }
      });
      await expect(
        fixture.create('inactive-create@example.test'),
      ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID, status: 401 });
      expect(
        await h.users.findOne({ email: 'inactive-create@example.test' }),
      ).toBeNull();
    });
  }

  for (const change of ACTOR_CHANGES) {
    for (const edit of ROLE_EDITS) {
      it(`rejects ${edit} after the actor is ${change}`, async () => {
        const { h } = fixture;
        fixture.beforeTransaction(async () => {
          if (change === 'missing') {
            await h.users.collection.deleteOne({
              _id: new Types.ObjectId(fixture.actorId),
            });
          } else {
            await h.users.collection.updateOne(
              { _id: new Types.ObjectId(fixture.actorId) },
              {
                $set:
                  change === 'deleted'
                    ? { isDeleted: true }
                    : { role: UserRole.SUPPORT },
              },
            );
          }
        });
        await expect(
          edit === 'delete'
            ? h.roles.delete(EDITOR_SLUG, fixture.actorId)
            : h.roles.update(
                EDITOR_SLUG,
                edit === 'rename'
                  ? { name: 'Content Lead' }
                  : edit === 'description'
                    ? { description: 'Edited description' }
                    : { permissions: ['posts:write:all'] },
                fixture.actorId,
              ),
        ).rejects.toMatchObject({
          code:
            change === 'demoted'
              ? ErrorCode.CANNOT_MODIFY_HIGHER_ROLE
              : ErrorCode.SESSION_INVALID,
          status: change === 'demoted' ? 403 : 401,
        });
        const role = await h.roleModel.findOne({ slug: EDITOR_SLUG });
        expect(role?.slug).toBe(EDITOR_SLUG);
        expect(role?.permissions).toEqual(['posts:read:all']);
        expect(await h.events.countDocuments({})).toBe(0);
      });
    }
  }

  it('attributes a permission edit revocation to the acting administrator', async () => {
    const { h } = fixture;
    const holder = await fixture.seed('holder@example.test', EDITOR_SLUG);
    await h.roles.update(
      EDITOR_SLUG,
      { permissions: ['posts:write:all'] },
      fixture.actorId,
    );
    expect((await h.users.findById(holder._id))?.sessionVersion).toBe(1);
    const events = await h.events
      .find({ targetUserId: holder._id.toString() })
      .lean();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: fixture.actorId,
      reasonCode: REVOKED_REASON.ADMIN_FORCED,
    });
  });

  it('retains permission-based role management for a non-admin actor', async () => {
    const { h } = fixture;
    await h.roleModel.updateOne(
      { slug: UserRole.MANAGER },
      {
        $set: {
          permissions: [ROLE_PERMISSIONS.UPDATE_ALL, 'posts:write:all'],
        },
      },
    );
    const actor = await fixture.seed(
      'authorized-manager@example.test',
      UserRole.MANAGER,
    );
    await h.roles.update(
      EDITOR_SLUG,
      { permissions: ['posts:write:all'] },
      actor._id.toString(),
    );
    expect(
      (await h.roleModel.findOne({ slug: EDITOR_SLUG }))?.permissions,
    ).toEqual(['posts:write:all']);
  });

  it('performs fresh hierarchy reads sequentially on the transaction session', async () => {
    const { h } = fixture;
    const target = await fixture.seed('sequential@example.test');
    const original = h.roleModel.collection.findOne.bind(
      h.roleModel.collection,
    );
    const busy = new Set<unknown>();
    jest
      .spyOn(h.roleModel.collection, 'findOne')
      .mockImplementation(async (...args) => {
        const session = args[1]?.session;
        if (session && busy.has(session)) {
          throw new Error('parallel reads on one session');
        }
        if (session) {
          busy.add(session);
        }
        try {
          return await original(...args);
        } finally {
          busy.delete(session);
        }
      });
    await fixture.assign(target._id.toString());
    expect((await h.users.findById(target._id))?.role).toBe(EDITOR_SLUG);
    expect((await h.users.findById(target._id))?.sessionVersion).toBe(1);
  });
});
