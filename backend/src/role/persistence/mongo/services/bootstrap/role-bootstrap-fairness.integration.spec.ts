import { Role, RoleDocument } from '../../schemas/role.schema';
import { MongoNetworkError } from 'mongodb';
import { Types } from 'mongoose';
import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import { finishBootstrap } from '../../../../services/bootstrap/role-bootstrap.harness-spec';
import { mongoRoleSweepBootstrap } from '../../../../../../test/utils/role/mongo-role-services';
import { useAdminRoundFour } from '../../../../../admin/persistence/mongo/services/admin-round-four.harness-spec';

const FAILED_OWNERS = 16;
const REACHABLE_SLUG = 'reachable-lead';
const STALE_SLUG = 'reachable-editor';

describe('startup owner queue makes progress', () => {
  const fixture = useAdminRoundFour('round_nine_bootstrap_fairness');
  it('orders older owners first and rotates failures so the seventeenth owner is reachable', async () => {
    const { h } = fixture;
    // Insert the youngest owner first, so natural order cannot satisfy the queue order.
    const reachable = await h.roleModel.create({
      name: 'Reachable Lead',
      slug: REACHABLE_SLUG,
      permissions: [],
    });
    const failed = await h.roleModel.create(
      Array.from({ length: FAILED_OWNERS }, (_, index) => ({
        name: `Failed Owner ${index}`,
        slug: `failed-owner-${index}`,
        permissions: [],
      })),
    );
    for (const [index, owner] of [reachable, ...failed].entries()) {
      await h.roleModel.updateOne(
        { _id: owner._id },
        {
          $set: {
            updatedAt: new Date('2098-01-01T00:00:00.000Z'),
            pendingHolderSweeps: [
              {
                roleId: owner._id,
                previousSlug:
                  index === 0 ? STALE_SLUG : `failed-source-${index}`,
                actorId: fixture.roleActorId,
              },
            ],
          },
        },
        { timestamps: false },
      );
    }
    await h.roleModel.updateMany(
      { _id: { $in: failed.map((owner) => owner._id) } },
      {
        $set: { updatedAt: new Date('2097-01-01T00:00:00.000Z') },
      },
      { timestamps: false },
    );
    const target = await fixture.seed('reachable@example.test', STALE_SLUG);
    const failedIds = new Set(failed.map((owner) => owner._id.toString()));
    const read = h.roleModel.collection.findOne.bind(h.roleModel.collection);
    jest
      .spyOn(h.roleModel.collection, 'findOne')
      .mockImplementation(async (...args) => {
        if (
          args[1]?.session &&
          args[0]?._id instanceof Types.ObjectId &&
          failedIds.has(args[0]._id.toString())
        )
          throw new MongoNetworkError('pending owner unavailable');
        return read(...args);
      });
    const bootstrap = mongoRoleSweepBootstrap(
      h.connection.model<RoleDocument>(Role.name),
      h.users,
      h.connection,
      h.app.get(SecurityEventService),
      h.clock,
    );
    await finishBootstrap([bootstrap]);
    expect((await h.users.findById(target._id))?.role).toBe(STALE_SLUG);
    expect(
      await h.events.countDocuments({ targetUserId: target._id.toString() }),
    ).toBe(0);
    await finishBootstrap([bootstrap]);
    expect((await h.users.findById(target._id))?.role).toBe(REACHABLE_SLUG);
    expect((await h.users.findById(target._id))?.sessionVersion).toBe(1);
    expect(
      (await h.roleModel.findById(reachable._id))?.pendingHolderSweeps,
    ).toEqual([]);
    const events = await h.events
      .find({ targetUserId: target._id.toString() })
      .lean();
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(fixture.roleActorId);
    expect(
      await h.roleModel.countDocuments({
        _id: { $in: failed.map((owner) => owner._id) },
        updatedAt: h.clock.now(),
      }),
    ).toBe(16);
  });
});
