import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

describe('delete restoration uses the cause and previous role', () => {
  const fixture = useAdminRoundFour('round_seven_delete_order');

  it('restores a stranded holder to manager with the deleting actor after commit', async () => {
    const { h } = fixture;
    const target = await fixture.seed(
      'delete-order@example.test',
      UserRole.MANAGER,
    );
    await fixture.assign(target._id.toString());
    await h.users.collection.updateOne(
      { _id: target._id },
      { $set: { role: UserRole.MANAGER } },
    );
    const postCommit = new RaceGate();
    const start = h.connection.startSession.bind(h.connection);
    let sessions = 0;
    jest
      .spyOn(h.connection, 'startSession')
      .mockImplementation(async (...args) => {
        sessions += 1;
        if (sessions === 2) await postCommit.hold();
        return start(...args);
      });
    const deletion = h.roles.delete(EDITOR_SLUG, fixture.roleActorId);
    const settled = Promise.allSettled([deletion]);
    try {
      const reached = await Promise.race([
        postCommit.reached().then(() => true),
        settled.then(() => false),
      ]);
      expect(reached).toBe(true);
      await h.users.collection.updateOne(
        { _id: target._id },
        { $set: { role: EDITOR_SLUG } },
      );
    } finally {
      postCommit.release();
      await settled;
    }
    await deletion;
    const stored = await h.users.findById(target._id);
    expect(stored?.role).toBe(UserRole.MANAGER);
    expect(stored?.sessionVersion).toBe(2);
    expect(await h.users.countDocuments({ role: EDITOR_SLUG })).toBe(0);
    const events = await h.events
      .find({ targetUserId: target._id.toString() })
      .sort({ _id: 1 })
      .lean();
    expect(events).toHaveLength(2);
    expect(
      events.map((event) => ({
        actorId: event.actorId,
        reasonCode: event.reasonCode,
      })),
    ).toEqual([
      { actorId: fixture.actorId, reasonCode: REVOKED_REASON.ADMIN_FORCED },
      { actorId: fixture.roleActorId, reasonCode: REVOKED_REASON.ADMIN_FORCED },
    ]);
  });

  it('refuses assignment while deletion holds the role fence', async () => {
    const { h } = fixture;
    const target = await fixture.seed(
      'delete-order@example.test',
      UserRole.MANAGER,
    );
    const gate = new RaceGate();
    const remove = h.roleModel.collection.deleteOne.bind(
      h.roleModel.collection,
    );
    jest
      .spyOn(h.roleModel.collection, 'deleteOne')
      .mockImplementationOnce(async (...args) => {
        await gate.hold();
        return remove(...args);
      });
    const deletion = h.roles.delete(EDITOR_SLUG, fixture.roleActorId);
    const settled = Promise.allSettled([deletion]);
    try {
      await gate.reached();
      await expect(fixture.assign(target._id.toString())).rejects.toMatchObject(
        {
          code: ErrorCode.AUTHORITY_UNAVAILABLE,
          status: 503,
        },
      );
      expect((await h.users.findById(target._id))?.role).toBe(UserRole.MANAGER);
    } finally {
      gate.release();
      await settled;
    }
    await deletion;
    expect(await h.roleModel.findOne({ slug: EDITOR_SLUG })).toBeNull();
    expect((await h.users.findById(target._id))?.sessionVersion).toBe(0);
    expect(
      await h.events.countDocuments({ targetUserId: target._id.toString() }),
    ).toBe(0);
  });
});
