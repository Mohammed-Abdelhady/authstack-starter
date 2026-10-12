import { Types } from 'mongoose';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import {
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../../../../../session/constants/security-event-action';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import { TEST_NOW } from '../../../../../../test/utils/frozen-clock';
import {
  EDITOR_SLUG,
  OLD_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

describe('bulk restoration preserves individual previous roles', () => {
  const fixture = useAdminRoundFour('round_five_restore_history');
  it('restores each straggler to its own previous role', async () => {
    const { h } = fixture;
    const first = await fixture.seed('first-history@example.test', OLD_SLUG);
    const second = await fixture.seed(
      'second-history@example.test',
      UserRole.SUPPORT,
    );
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const request = fixture.assign(first._id.toString());
    const settled = Promise.allSettled([request]);
    try {
      await gate.reached();
      await fixture.assign(second._id.toString());
      await h.roleModel.collection.deleteOne({ slug: EDITOR_SLUG });
    } finally {
      gate.release();
      await settled;
    }
    await expect(request).rejects.toMatchObject({
      code: ErrorCode.ROLE_NOT_FOUND,
      status: 404,
    });
    expect((await h.users.findById(first._id))?.role).toBe(OLD_SLUG);
    expect((await h.users.findById(second._id))?.role).toBe(UserRole.SUPPORT);
    expect((await h.users.findById(first._id))?.sessionVersion).toBe(2);
    expect((await h.users.findById(second._id))?.sessionVersion).toBe(2);
    for (const id of [first._id, second._id]) {
      const events = await h.events
        .find({ targetUserId: id.toString() })
        .lean();
      expect(events).toHaveLength(2);
      expect(
        events.map((event) => ({
          actorId: event.actorId,
          reasonCode: event.reasonCode,
        })),
      ).toEqual([
        { actorId: fixture.actorId, reasonCode: REVOKED_REASON.ADMIN_FORCED },
        { actorId: fixture.actorId, reasonCode: REVOKED_REASON.ADMIN_FORCED },
      ]);
    }
  });
  it('restores an existing previous role without requiring the missing default', async () => {
    const { h } = fixture;
    const target = await fixture.seed(
      'previous-without-default@example.test',
      UserRole.SUPPORT,
    );
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const request = fixture.assign(target._id.toString());
    const settled = Promise.allSettled([request]);
    try {
      await gate.reached();
      await h.roleModel.collection.deleteOne({ slug: EDITOR_SLUG });
      await h.roleModel.collection.deleteOne({ slug: UserRole.USER });
    } finally {
      gate.release();
      await settled;
    }
    await expect(request).rejects.toMatchObject({
      code: ErrorCode.ROLE_NOT_FOUND,
      status: 404,
    });
    expect((await h.users.findById(target._id))?.role).toBe(UserRole.SUPPORT);
    expect((await h.users.findById(target._id))?.sessionVersion).toBe(2);
    expect(
      await h.events.countDocuments({ targetUserId: target._id.toString() }),
    ).toBe(2);
  });

  it('falls back to the default for a holder without assignment history', async () => {
    const { h } = fixture;
    const legacy = await fixture.seed(
      'legacy-history@example.test',
      EDITOR_SLUG,
    );
    const caller = await fixture.seed('caller-history@example.test', OLD_SLUG);
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const request = fixture.assign(caller._id.toString());
    const settled = Promise.allSettled([request]);
    try {
      await gate.reached();
      await h.roleModel.collection.deleteOne({ slug: EDITOR_SLUG });
    } finally {
      gate.release();
      await settled;
    }
    await expect(request).rejects.toMatchObject({
      code: ErrorCode.ROLE_NOT_FOUND,
    });
    expect((await h.users.findById(legacy._id))?.role).toBe(UserRole.USER);
    expect((await h.users.findById(legacy._id))?.sessionVersion).toBe(1);
    expect(
      await h.events.countDocuments({ targetUserId: legacy._id.toString() }),
    ).toBe(1);
    expect((await h.users.findById(caller._id))?.role).toBe(OLD_SLUG);
    expect((await h.users.findById(caller._id))?.sessionVersion).toBe(2);
  });

  it('uses the newest assignment version when timestamps tie and ids order differently', async () => {
    const { h } = fixture;
    const target = await fixture.seed('ordered-history@example.test', OLD_SLUG);
    await fixture.assign(target._id.toString());
    await fixture.assign(target._id.toString(), UserRole.SUPPORT);
    const insert = h.events.collection.insertOne.bind(h.events.collection);
    jest
      .spyOn(h.events.collection, 'insertOne')
      .mockImplementationOnce(async (...args) => {
        args[0]._id = new Types.ObjectId('000000000000000000000003');
        return insert(...args);
      });
    await fixture.assign(target._id.toString());
    const editor = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    const old = await h.roleModel.findOne({ slug: OLD_SLUG }).orFail();
    await h.events.collection.deleteOne({
      targetUserId: target._id.toString(),
      'roleAssignment.sessionVersion': 1,
    });
    await h.events.collection.insertOne({
      _id: new Types.ObjectId('000000000000000000000001'),
      eventId: 'late-inserted-old-assignment',
      targetUserId: target._id.toString(),
      actorId: fixture.actorId,
      action: SECURITY_EVENT_ACTION.SESSIONS_REVOKED_ALL,
      outcome: SECURITY_EVENT_OUTCOME.SUCCEEDED,
      reasonCode: REVOKED_REASON.ADMIN_FORCED,
      occurredAt: TEST_NOW,
      roleAssignment: {
        assignedRoleId: editor._id.toString(),
        previousRoleId: old._id.toString(),
        sessionVersion: 1,
      },
    });
    const caller = await fixture.seed('ordering-caller@example.test', OLD_SLUG);
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const request = fixture.assign(caller._id.toString());
    const settled = Promise.allSettled([request]);
    try {
      await gate.reached();
      await h.roleModel.collection.deleteOne({ slug: EDITOR_SLUG });
    } finally {
      gate.release();
      await settled;
    }
    await expect(request).rejects.toMatchObject({
      code: ErrorCode.ROLE_NOT_FOUND,
    });
    const stored = await h.users.findById(target._id);
    expect(stored?.role).toBe(UserRole.SUPPORT);
    expect(stored?.sessionVersion).toBe(4);
    const events = await h.events
      .find({ targetUserId: target._id.toString() })
      .lean();
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.occurredAt)).toEqual([
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
    ]);
  });
});
