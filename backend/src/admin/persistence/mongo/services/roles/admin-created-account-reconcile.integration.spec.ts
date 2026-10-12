import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

describe('created accounts retained during deleted-role reconciliation', () => {
  const fixture = useAdminRoundFour('round_five_created_reconcile');

  it('refuses account creation while deletion holds the role authority fence', async () => {
    const { h } = fixture;
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    const deleteGate = new RaceGate();
    const remove = h.roleModel.collection.deleteOne.bind(
      h.roleModel.collection,
    );
    jest
      .spyOn(h.roleModel.collection, 'deleteOne')
      .mockImplementationOnce(async (...args) => {
        await deleteGate.hold();
        return remove(...args);
      });
    const deletion = h.roles.delete(EDITOR_SLUG, fixture.roleActorId);
    const deleteSettled = Promise.allSettled([deletion]);
    try {
      await deleteGate.reached();
      await expect(
        fixture.create('swept-created@example.test'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTHORITY_UNAVAILABLE,
        status: 503,
      });
      expect(
        await h.users.countDocuments({ email: 'swept-created@example.test' }),
      ).toBe(0);
    } finally {
      deleteGate.release();
      await deleteSettled;
    }
    await deletion;
    expect(await h.roleModel.findById(role._id)).toBeNull();
    expect(
      await h.users.countDocuments({ email: 'swept-created@example.test' }),
    ).toBe(0);
    const recovered = await fixture.create(
      'swept-created@example.test',
      UserRole.USER,
    );
    expect(recovered.data?.role).toBe(UserRole.USER);
  });

  it('preserves an edited account and repairs its dead slug before answering success', async () => {
    const { h } = fixture;
    const gate = new RaceGate();
    fixture.holdReconcile(gate);
    const creation = fixture.create('edited-created@example.test');
    const settled = Promise.allSettled([creation]);
    try {
      await gate.reached();
      await h.users.collection.updateOne(
        { email: 'edited-created@example.test' },
        {
          $set: { name: 'Edited account', updatedAt: h.clock.now() },
        },
      );
      await h.roleModel.collection.deleteOne({ slug: EDITOR_SLUG });
    } finally {
      gate.release();
      await settled;
    }
    expect((await creation).data?.role).toBe(UserRole.USER);
    const account = await h.users
      .findOne({ email: 'edited-created@example.test' })
      .orFail();
    expect(account.name).toBe('Edited account');
    expect(account.role).toBe(UserRole.USER);
    expect(account.sessionVersion).toBe(1);
    expect(
      await h.users.countDocuments({ email: 'edited-created@example.test' }),
    ).toBe(1);
    const events = await h.events
      .find({ targetUserId: account._id.toString() })
      .lean();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: fixture.actorId,
      reasonCode: REVOKED_REASON.ADMIN_FORCED,
    });
  });
});
