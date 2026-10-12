import { Role, RoleDocument } from '../../schemas/role.schema';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import { ROLE_SWEEP_BOOTSTRAP_BUDGET_EXHAUSTED } from '../../../../../common/constants/roles';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import { mongoRoleSweepBootstrap } from '../../../../../../test/utils/role/mongo-role-services';
import { finishBootstrap } from '../../../../services/bootstrap/role-bootstrap.harness-spec';
import { useAdminRoundFour } from '../../../../../admin/persistence/mongo/services/admin-round-four.harness-spec';

const STOPS = ['budget', 'shutdown'] as const;
const FIRST_SLUG = 'bounded-first';
const SECOND_SLUG = 'bounded-second';
const FIRST_SOURCE = 'first-stale';
const NEXT_SOURCE = 'next-stale';
const SECOND_SOURCE = 'second-stale';

describe('startup stops between repair entries', () => {
  const fixture = useAdminRoundFour('round_nine_bootstrap_limits');
  for (const stop of STOPS)
    it(`finishes the current entry and retains later references after ${stop}`, async () => {
      const { h } = fixture;
      const first = await h.roleModel.create({
        _id: new Types.ObjectId('000000000000000000000031'),
        name: 'Bounded First',
        slug: FIRST_SLUG,
        permissions: [],
      });
      const second = await h.roleModel.create({
        _id: new Types.ObjectId('000000000000000000000032'),
        name: 'Bounded Second',
        slug: SECOND_SLUG,
        permissions: [],
      });
      for (const [owner, sources] of [
        [first, [FIRST_SOURCE, NEXT_SOURCE]],
        [second, [SECOND_SOURCE]],
      ] as const) {
        await h.roleModel.updateOne(
          { _id: owner._id },
          {
            $set: {
              updatedAt: new Date('2098-01-01T00:00:00.000Z'),
              pendingHolderSweeps: sources.map((previousSlug) => ({
                roleId: owner._id,
                previousSlug,
                actorId: fixture.roleActorId,
              })),
            },
          },
          { timestamps: false },
        );
      }
      const holder = await fixture.seed(
        'first-bound@example.test',
        FIRST_SOURCE,
      );
      const next = await fixture.seed('next-bound@example.test', NEXT_SOURCE);
      const later = await fixture.seed(
        'later-bound@example.test',
        SECOND_SOURCE,
      );
      const gate = new RaceGate();
      const write = h.roleModel.collection.updateOne.bind(
        h.roleModel.collection,
      );
      let held = false;
      jest
        .spyOn(h.roleModel.collection, 'updateOne')
        .mockImplementation(async (...args) => {
          const result = await write(...args);
          if (!held && !Array.isArray(args[1]) && args[1]?.$pull) {
            held = true;
            await gate.hold();
          }
          return result;
        });
      const scans = jest.spyOn(h.events.collection, 'find');
      const warned = new RaceGate();
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation((entry: unknown) => {
          if (
            typeof entry === 'object' &&
            entry !== null &&
            'event' in entry &&
            entry.event === ROLE_SWEEP_BOOTSTRAP_BUDGET_EXHAUSTED
          )
            void warned.hold();
        });
      const bootstrap = mongoRoleSweepBootstrap(
        h.connection.model<RoleDocument>(Role.name),
        h.users,
        h.connection,
        h.app.get(SecurityEventService),
        h.clock,
      );
      const finished = finishBootstrap([bootstrap]);
      let shutdown: Promise<void> | undefined;
      try {
        const reached = await Promise.race([
          gate.reached().then(() => true),
          finished.then(() => false),
        ]);
        if (!reached)
          throw new Error(
            JSON.stringify({
              phase: 'first repair entry',
              owners: await h.roleModel
                .find({ _id: { $in: [first._id, second._id] } })
                .lean(),
              holders: await h.users
                .find({ _id: { $in: [holder._id, next._id, later._id] } })
                .select('role sessionVersion')
                .lean(),
            }),
          );
        if (stop === 'budget') h.clock.advance(30_000);
        else shutdown = bootstrap.onApplicationShutdown();
        gate.release();
        if (stop === 'budget') {
          const budgetLogged = await Promise.race([
            warned.reached().then(() => true),
            finished.then(() => false),
          ]);
          if (!budgetLogged)
            throw new Error(
              JSON.stringify({
                phase: 'budget boundary',
                warnings: warn.mock.calls,
              }),
            );
          shutdown = bootstrap.onApplicationShutdown();
        }
        await shutdown;
      } finally {
        gate.release();
        warned.release();
        await finished;
      }
      expect((await h.users.findById(holder._id))?.role).toBe(FIRST_SLUG);
      expect((await h.users.findById(holder._id))?.sessionVersion).toBe(1);
      expect((await h.users.findById(next._id))?.role).toBe(NEXT_SOURCE);
      expect((await h.users.findById(next._id))?.sessionVersion).toBe(0);
      expect((await h.users.findById(later._id))?.role).toBe(SECOND_SOURCE);
      expect((await h.users.findById(later._id))?.sessionVersion).toBe(0);
      expect(
        (await h.roleModel.findById(first._id))?.pendingHolderSweeps.map(
          (ref) => ref.previousSlug,
        ),
      ).toEqual([NEXT_SOURCE]);
      expect(
        (await h.roleModel.findById(second._id))?.pendingHolderSweeps.map(
          (ref) => ref.previousSlug,
        ),
      ).toEqual([SECOND_SOURCE]);
      expect(
        await h.events.countDocuments({ targetUserId: holder._id.toString() }),
      ).toBe(1);
      expect(
        await h.events.countDocuments({
          targetUserId: { $in: [next._id.toString(), later._id.toString()] },
        }),
      ).toBe(0);
      expect(
        scans.mock.calls.filter(
          ([filter]) => filter?.['roleDeletionSweep.pending'] === true,
        ),
      ).toHaveLength(0);
      if (stop === 'budget')
        expect(warn).toHaveBeenCalledWith({
          event: ROLE_SWEEP_BOOTSTRAP_BUDGET_EXHAUSTED,
          budgetMs: 30_000,
        });
    });
});
