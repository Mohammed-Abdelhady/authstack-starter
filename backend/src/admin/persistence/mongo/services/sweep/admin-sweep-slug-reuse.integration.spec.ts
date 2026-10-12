import { Logger } from '@nestjs/common';
import { ClientSessionOptions, Types } from 'mongoose';
import { ROLE_SWEEP_SLUG_REUSED } from '../../../../../common/constants/roles';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  LEAD_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

const OPERATIONS = ['rename', 'delete'] as const;

describe('a reused slug stops an older holder sweep', () => {
  const fixture = useAdminRoundFour('round_five_slug_reuse');
  for (const operation of OPERATIONS) {
    it(`preserves new role holders when the old slug is recreated after ${operation}`, async () => {
      const { h } = fixture;
      const originalRole = await h.roleModel
        .findOne({ slug: EDITOR_SLUG })
        .orFail();
      const target = await fixture.seed('new-role-holder@example.test');
      if (operation === 'rename')
        await fixture.seed('original-holder@example.test', EDITOR_SLUG);
      const gate = new RaceGate();
      let committed = false;
      const start = h.connection.startSession.bind(h.connection);
      jest
        .spyOn(h.connection, 'startSession')
        .mockImplementationOnce(async (options?: ClientSessionOptions) => {
          const session = await start(options);
          const commit = session.commitTransaction.bind(session);
          jest
            .spyOn(session, 'commitTransaction')
            .mockImplementationOnce(async () => {
              await commit();
              committed = true;
            });
          return session;
        });
      const find = h.roleModel.collection.findOne.bind(h.roleModel.collection);
      jest
        .spyOn(h.roleModel.collection, 'findOne')
        .mockImplementation(async (...args) => {
          if (
            committed &&
            args[0]?._id instanceof Types.ObjectId &&
            args[0]._id.equals(originalRole._id) &&
            args[1]?.session
          ) {
            committed = false;
            await gate.hold();
          }
          return find(...args);
        });
      const log = jest.spyOn(Logger.prototype, 'warn');
      const edit =
        operation === 'rename'
          ? h.roles.update(
              EDITOR_SLUG,
              { name: 'Content Lead' },
              fixture.roleActorId,
            )
          : h.roles.delete(EDITOR_SLUG, fixture.roleActorId);
      const settled = Promise.allSettled([edit]);
      try {
        await gate.reached();
        await h.roles.create(
          { name: 'Content Editor', permissions: [] },
          fixture.roleActorId,
        );
        await fixture.assign(target._id.toString());
      } finally {
        gate.release();
        await settled;
      }
      await edit;
      const stored = await h.users.findById(target._id);
      expect(stored?.role).toBe(EDITOR_SLUG);
      expect(stored?.sessionVersion).toBe(1);
      const events = await h.events
        .find({ targetUserId: target._id.toString() })
        .lean();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: fixture.actorId,
        reasonCode: REVOKED_REASON.ADMIN_FORCED,
      });
      expect(log).toHaveBeenCalledWith({
        event: ROLE_SWEEP_SLUG_REUSED,
        roleId: originalRole._id.toString(),
        previousSlug: EDITOR_SLUG,
        actorId: fixture.roleActorId,
      });
      if (operation === 'rename')
        expect(
          (await h.users.findOne({ email: 'original-holder@example.test' }))
            ?.role,
        ).toBe(LEAD_SLUG);
    });
  }
});
