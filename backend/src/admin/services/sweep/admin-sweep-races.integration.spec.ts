import { UserRole } from '../../../user/enums/user-role.enum';
import { RaceGate } from '../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  LEAD_SLUG,
  FRESH_SLUG,
  useAdminRoundFour,
} from '../../persistence/mongo/services/admin-round-four.harness-spec';

const DESTINATION_CHANGES = ['rename', 'delete', 'rename back'] as const;

describe('role sweep destinations remain live', () => {
  const fixture = useAdminRoundFour('round_four_sweep');
  for (const change of DESTINATION_CHANGES) {
    it(`re-reads a destination changed by ${change} after its snapshot`, async () => {
      const { h } = fixture;
      const holder = await fixture.seed('holder@example.test', EDITOR_SLUG);
      const target = await fixture.seed('straggler@example.test');
      await fixture.assign(target._id.toString());
      const postCommitGate = new RaceGate();
      const repairGate = new RaceGate();
      const start = h.connection.startSession.bind(h.connection);
      let sessions = 0;
      jest
        .spyOn(h.connection, 'startSession')
        .mockImplementation(async (...args) => {
          sessions += 1;
          if (sessions === 2) await postCommitGate.hold();
          return start(...args);
        });
      const originalRoleWrite = h.roleModel.collection.updateOne.bind(
        h.roleModel.collection,
      );
      let held = false;
      jest
        .spyOn(h.roleModel.collection, 'updateOne')
        .mockImplementation(async (...args) => {
          const update = args[1];
          if (
            !held &&
            !Array.isArray(update) &&
            update?.$inc?.__v === 1 &&
            !update.$set
          ) {
            held = true;
            await repairGate.hold();
          }
          return originalRoleWrite(...args);
        });
      const firstRename = h.roles.update(
        EDITOR_SLUG,
        { name: 'Content Lead' },
        fixture.roleActorId,
      );
      const firstSettled = Promise.allSettled([firstRename]);
      async function reachOrDiagnose(gate: RaceGate, phase: string) {
        const reached = await Promise.race([
          gate.reached().then(() => true),
          firstSettled.then(() => false),
        ]);
        if (!reached) {
          throw new Error(
            JSON.stringify({
              phase,
              outcomes: await firstSettled,
              holder: await h.users.findById(holder._id).lean(),
              straggler: await h.users.findById(target._id).lean(),
              roles: await h.roleModel
                .find()
                .select('slug pendingHolderSweeps')
                .lean(),
            }),
          );
        }
      }
      try {
        await reachOrDiagnose(postCommitGate, 'post-commit repair start');
        await h.users.collection.updateOne(
          { _id: target._id },
          { $set: { role: EDITOR_SLUG } },
        );
        postCommitGate.release();
        await reachOrDiagnose(repairGate, 'destination fence');
        if (change === 'delete') {
          await fixture.assign(holder._id.toString(), UserRole.USER);
          await h.roles.delete(LEAD_SLUG, fixture.roleActorId);
        } else {
          await h.roles.update(
            LEAD_SLUG,
            {
              name: change === 'rename back' ? 'Content Editor' : 'Fresh Role',
            },
            fixture.roleActorId,
          );
        }
      } finally {
        postCommitGate.release();
        repairGate.release();
        await firstSettled;
      }
      await firstRename;
      const stored = await h.users.findById(target._id);
      expect(stored?.role).toBe(
        change === 'delete'
          ? UserRole.USER
          : change === 'rename back'
            ? EDITOR_SLUG
            : FRESH_SLUG,
      );
      expect(await h.roleModel.findOne({ slug: stored?.role })).not.toBeNull();
      expect(stored?.sessionVersion).toBe(change === 'rename back' ? 2 : 3);
      const events = await h.events
        .find({ targetUserId: target._id.toString() })
        .sort({ _id: 1 })
        .lean();
      expect(events.map((event) => event.actorId)).toEqual(
        change === 'rename back'
          ? [fixture.actorId, fixture.roleActorId]
          : [fixture.actorId, fixture.roleActorId, fixture.roleActorId],
      );
      expect(
        await h.events.countDocuments({ targetUserId: target._id.toString() }),
      ).toBe(change === 'rename back' ? 2 : 3);
    });
  }
});
