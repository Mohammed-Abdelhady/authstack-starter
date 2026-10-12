import { Logger } from '@nestjs/common';
import { MongoNetworkError } from 'mongodb';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import {
  ADMIN_ROLE_RECONCILE_FAILED,
  ADMIN_ROLE_CHANGED,
} from '../../../../constants/admin-user.constants';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  OLD_SLUG,
  FRESH_SLUG,
  LEAD_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

const PREVIOUS_ROLE_CHANGES = ['rename', 'delete'] as const;

describe('post-commit role reconciliation', () => {
  const fixture = useAdminRoundFour('round_four_restore');

  for (const change of PREVIOUS_ROLE_CHANGES) {
    it(`restores by role id when the previous role has a ${change}`, async () => {
      const { h } = fixture;
      const target = await fixture.seed('restore@example.test', OLD_SLUG);
      const gate = new RaceGate();
      fixture.holdReconcile(gate);
      const request = fixture.assign(target._id.toString());
      const settled = Promise.allSettled([request]);
      try {
        await gate.reached();
        if (change === 'rename') {
          await h.roles.update(
            OLD_SLUG,
            { name: 'Fresh Role' },
            fixture.actorId,
          );
        } else {
          await h.roles.delete(OLD_SLUG, fixture.actorId);
        }
        await h.roleModel.collection.deleteOne({ slug: EDITOR_SLUG });
      } finally {
        gate.release();
        await settled;
      }
      await expect(request).rejects.toMatchObject({
        code: ErrorCode.ROLE_NOT_FOUND,
        status: 404,
      });
      const stored = await h.users.findById(target._id);
      expect(stored?.role).toBe(
        change === 'rename' ? FRESH_SLUG : UserRole.USER,
      );
      expect(stored?.sessionVersion).toBe(2);
      expect(await h.roleModel.findOne({ slug: stored?.role })).not.toBeNull();
      const events = await h.events
        .find({ targetUserId: target._id.toString() })
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
    });
  }

  it('rolls the restore back if its revocation event cannot persist', async () => {
    const { h } = fixture;
    const target = await fixture.seed('restore-failure@example.test', OLD_SLUG);
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const request = fixture.assign(target._id.toString());
    const settled = Promise.allSettled([request]);
    try {
      await gate.reached();
      await h.roleModel.collection.deleteOne({ slug: EDITOR_SLUG });
      jest
        .spyOn(h.events.collection, 'insertMany')
        .mockRejectedValueOnce(
          new MongoNetworkError('event store unavailable'),
        );
    } finally {
      gate.release();
      await settled;
    }
    await expect(request).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
      status: 503,
    });
    const stored = await h.users.findById(target._id);
    expect(stored?.role).toBe(EDITOR_SLUG);
    expect(stored?.sessionVersion).toBe(1);
    expect(
      await h.events.countDocuments({ targetUserId: target._id.toString() }),
    ).toBe(1);
  });

  it('reports and logs the live slug after two renames', async () => {
    const { h } = fixture;
    const target = await fixture.seed('response@example.test');
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const log = jest.spyOn(Logger.prototype, 'log');
    const request = fixture.assign(target._id.toString());
    const settled = Promise.allSettled([request]);
    try {
      await gate.reached();
      await h.roles.update(
        EDITOR_SLUG,
        { name: 'Content Lead' },
        fixture.actorId,
      );
      await h.roles.update(LEAD_SLUG, { name: 'Fresh Role' }, fixture.actorId);
    } finally {
      gate.release();
      await settled;
    }
    expect((await request).data?.role).toBe(FRESH_SLUG);
    expect((await h.users.findById(target._id))?.role).toBe(FRESH_SLUG);
    expect(log).toHaveBeenCalledWith({
      event: ADMIN_ROLE_CHANGED,
      userId: target._id.toString(),
      role: FRESH_SLUG,
      actorId: fixture.actorId,
    });
  });

  it('logs the committed assignment distinctly when reconciliation fails', async () => {
    const { h } = fixture;
    const target = await fixture.seed('log-failure@example.test');
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG });
    const error = new MongoNetworkError(
      'reconcile read failed for private@example.test',
    );
    const original = h.roleModel.collection.findOne.bind(
      h.roleModel.collection,
    );
    let failed = false;
    jest
      .spyOn(h.roleModel.collection, 'findOne')
      .mockImplementation(async (...args) => {
        if (!failed && args[0]?._id && !args[1]?.session) {
          failed = true;
          throw error;
        }
        return original(...args);
      });
    const log = jest.spyOn(Logger.prototype, 'error');
    await expect(fixture.assign(target._id.toString())).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
      status: 503,
    });
    expect((await h.users.findById(target._id))?.role).toBe(EDITOR_SLUG);
    expect(log).toHaveBeenCalledWith({
      event: ADMIN_ROLE_RECONCILE_FAILED,
      userId: target._id.toString(),
      roleId: role?._id.toString(),
      error: 'name=MongoNetworkError',
    });
  });

  it('preserves an intervening reassignment when the assigned role is deleted', async () => {
    const { h } = fixture;
    const target = await fixture.seed(
      'concurrent-restore@example.test',
      OLD_SLUG,
    );
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const request = fixture.assign(target._id.toString());
    const settled = Promise.allSettled([request]);
    try {
      await gate.reached();
      await h.users.collection.updateOne(
        { _id: target._id },
        { $set: { role: UserRole.SUPPORT } },
      );
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
    expect(stored?.sessionVersion).toBe(1);
    expect(
      await h.events.countDocuments({ targetUserId: target._id.toString() }),
    ).toBe(1);
  });
  it('preserves a created account changed before a deleted-role cleanup', async () => {
    const { h } = fixture;
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const request = fixture.create('changed-create@example.test');
    const settled = Promise.allSettled([request]);
    try {
      await gate.reached();
      await h.users.collection.updateOne(
        { email: 'changed-create@example.test' },
        { $set: { role: UserRole.SUPPORT } },
      );
      await h.roleModel.collection.deleteOne({ slug: EDITOR_SLUG });
    } finally {
      gate.release();
      await settled;
    }
    expect((await request).data?.role).toBe(UserRole.SUPPORT);
    expect(
      (await h.users.findOne({ email: 'changed-create@example.test' }))?.role,
    ).toBe(UserRole.SUPPORT);
  });
});
