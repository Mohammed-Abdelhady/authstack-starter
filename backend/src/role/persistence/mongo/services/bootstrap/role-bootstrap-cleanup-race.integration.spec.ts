import { MongoNetworkError } from 'mongodb';
import { Role, RoleDocument } from '../../schemas/role.schema';
import {
  User,
  UserDocument,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import { mongoRoleSweepBootstrap } from '../../../../../../test/utils/role/mongo-role-services';
import { finishBootstrap } from '../../../../services/bootstrap/role-bootstrap.harness-spec';
import {
  EDITOR_SLUG,
  LEAD_SLUG,
  useAdminRoundFour,
} from '../../../../../admin/persistence/mongo/services/admin-round-four.harness-spec';

describe('startup cleanup preserves newer pending work', () => {
  const fixture = useAdminRoundFour('round_seven_cleanup_race');
  it('keeps a newer rename reference when an older empty sweep cleans up', async () => {
    const { h } = fixture;
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    let preparing = false;
    const prepareWrite = h.roleModel.collection.updateOne.bind(
      h.roleModel.collection,
    );
    jest
      .spyOn(h.roleModel.collection, 'updateOne')
      .mockImplementation(async (...args) => {
        const result = await prepareWrite(...args);
        if (!Array.isArray(args[1]) && args[1]?.$set?.slug === LEAD_SLUG)
          preparing = true;
        return result;
      });
    const prepareRead = h.roleModel.collection.findOne.bind(
      h.roleModel.collection,
    );
    jest
      .spyOn(h.roleModel.collection, 'findOne')
      .mockImplementation(async (...args) => {
        if (preparing && args[0]?._id)
          throw new MongoNetworkError('initial sweep unavailable');
        return prepareRead(...args);
      });
    await h.roles.update(
      EDITOR_SLUG,
      { name: 'Content Lead' },
      fixture.roleActorId,
    );
    jest.restoreAllMocks();
    const gate = new RaceGate();
    const write = h.roleModel.collection.updateOne.bind(h.roleModel.collection);
    let held = false;
    let fail = false;
    jest
      .spyOn(h.roleModel.collection, 'updateOne')
      .mockImplementation(async (...args) => {
        if (!held && !Array.isArray(args[1]) && args[1]?.$pull) {
          held = true;
          await gate.hold();
        }
        const result = await write(...args);
        if (!Array.isArray(args[1]) && args[1]?.$set?.slug === LEAD_SLUG) {
          await fixture.seed('cleanup-straggler@example.test', EDITOR_SLUG);
          fail = true;
        }
        return result;
      });
    const read = h.roleModel.collection.findOne.bind(h.roleModel.collection);
    jest
      .spyOn(h.roleModel.collection, 'findOne')
      .mockImplementation(async (...args) => {
        if (fail && args[0]?._id)
          throw new MongoNetworkError('new sweep unavailable');
        return read(...args);
      });
    const bootstrap = mongoRoleSweepBootstrap(
      h.connection.model<RoleDocument>(Role.name),
      h.connection.model<UserDocument>(User.name),
      h.connection,
      h.app.get(SecurityEventService),
      h.clock,
    );
    const finished = finishBootstrap([bootstrap]);
    try {
      const reached = await Promise.race([
        gate.reached().then(() => true),
        finished.then(() => false),
      ]);
      if (!reached)
        throw new Error(
          JSON.stringify({
            phase: 'pending cleanup',
            role: await h.roleModel.findOne({ slug: LEAD_SLUG }).lean(),
            events: await h.events.countDocuments({}),
          }),
        );
      await h.roles.update(
        LEAD_SLUG,
        { name: 'Content Editor' },
        fixture.roleActorId,
      );
      await h.roles.update(
        EDITOR_SLUG,
        { name: 'Content Lead' },
        fixture.roleActorId,
      );
    } finally {
      gate.release();
      await finished;
      jest.restoreAllMocks();
    }
    const stored = await h.roleModel.findById(role._id).orFail();
    expect(stored.slug).toBe(LEAD_SLUG);
    expect(stored.pendingHolderSweeps).toHaveLength(1);
    expect(stored.pendingHolderSweeps[0]).toMatchObject({
      roleId: role._id,
      previousSlug: EDITOR_SLUG,
      actorId: fixture.roleActorId,
    });
    expect(
      (await h.users.findOne({ email: 'cleanup-straggler@example.test' }))
        ?.role,
    ).toBe(EDITOR_SLUG);
    const repaired = await h.roles.update(
      LEAD_SLUG,
      { description: 'Retry newer repair' },
      fixture.roleActorId,
    );
    expect(repaired.usersMoved).toBe(1);
    const target = await h.users
      .findOne({ email: 'cleanup-straggler@example.test' })
      .orFail();
    expect(target.role).toBe(LEAD_SLUG);
    expect(target.sessionVersion).toBe(1);
    expect(
      await h.events.countDocuments({ targetUserId: target._id.toString() }),
    ).toBe(1);
    expect((await h.roleModel.findById(role._id))?.pendingHolderSweeps).toEqual(
      [],
    );
  });
});
