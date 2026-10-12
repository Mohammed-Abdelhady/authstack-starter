import { MongoNetworkError, MongoServerError } from 'mongodb';
import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import { withMajorityTransaction } from '../../../../../common/persistence/mongo/mongo-transaction';
import { MONGO_TRANSIENT_TRANSACTION_LABEL } from '../../../../../common/constants/mongo-errors';
import { moveRoleHolders } from '../../../../../../test/utils/role/mongo-role-holder-sweeps';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../../../../../admin/persistence/mongo/services/admin-round-four.harness-spec';

const OUTCOMES = ['failure', 'transient retry'] as const;

describe('bulk security events join the holder transaction', () => {
  const fixture = useAdminRoundFour('round_seven_bulk_events');
  for (const outcome of OUTCOMES) {
    it(`rolls successful event inserts back before a later ${outcome}`, async () => {
      const { h } = fixture;
      const holders = await Promise.all([
        fixture.seed('bulk-event-first@example.test', EDITOR_SLUG),
        fixture.seed('bulk-event-second@example.test', EDITOR_SLUG),
      ]);
      const failure =
        outcome === 'failure'
          ? new MongoNetworkError('later write unavailable')
          : new MongoServerError({ message: 'retry later write' });
      if (failure instanceof MongoServerError)
        failure.addErrorLabel(MONGO_TRANSIENT_TRANSACTION_LABEL);
      jest
        .spyOn(h.roleModel.collection, 'updateOne')
        .mockRejectedValueOnce(failure);
      const work = withMajorityTransaction(h.connection, async (session) => {
        await moveRoleHolders({
          userModel: h.users,
          events: h.app.get(SecurityEventService),
          previousSlugs: [EDITOR_SLUG],
          nextSlug: UserRole.SUPPORT,
          actorId: fixture.roleActorId,
          session,
        });
        await h.roleModel
          .updateOne(
            { slug: UserRole.SUPPORT },
            { $set: { description: 'Later write' } },
            { session },
          )
          .exec();
      });
      if (outcome === 'failure') await expect(work).rejects.toBe(failure);
      else await expect(work).resolves.toBeUndefined();
      for (const holder of holders) {
        const stored = await h.users.findById(holder._id);
        expect(stored?.role).toBe(
          outcome === 'failure' ? EDITOR_SLUG : UserRole.SUPPORT,
        );
        expect(stored?.sessionVersion).toBe(outcome === 'failure' ? 0 : 1);
        expect(
          await h.events.countDocuments({
            targetUserId: holder._id.toString(),
          }),
        ).toBe(outcome === 'failure' ? 0 : 1);
      }
    });
  }
});
