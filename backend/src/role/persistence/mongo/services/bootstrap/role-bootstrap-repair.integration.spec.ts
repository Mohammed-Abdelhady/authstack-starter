import { Logger } from '@nestjs/common';
import { MongoNetworkError } from 'mongodb';
import { ClientSessionOptions } from 'mongoose';
import { ROLE_SWEEP_PENDING } from '../../../../../common/constants/roles';
import { Role, RoleDocument } from '../../schemas/role.schema';
import {
  User,
  UserDocument,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import { withMajorityTransaction } from '../../../../../common/persistence/mongo/mongo-transaction';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import { mongoRoleSweepBootstrap } from '../../../../../../test/utils/role/mongo-role-services';
import { finishBootstrap } from '../../../../services/bootstrap/role-bootstrap.harness-spec';
import {
  EDITOR_SLUG,
  LEAD_SLUG,
  useAdminRoundFour,
} from '../../../../../admin/persistence/mongo/services/admin-round-four.harness-spec';

describe('startup retries durable role repairs', () => {
  const fixture = useAdminRoundFour('round_seven_bootstrap');
  function instance() {
    const { h } = fixture;
    return mongoRoleSweepBootstrap(
      h.connection.model<RoleDocument>(Role.name),
      h.connection.model<UserDocument>(User.name),
      h.connection,
      h.app.get(SecurityEventService),
      h.clock,
    );
  }
  it('does not block startup and concurrent instances repair a rename once', async () => {
    const { h } = fixture;
    const target = await fixture.seed(
      'bootstrap-rename@example.test',
      EDITOR_SLUG,
    );
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    await h.roleModel.updateOne(
      { _id: role._id },
      {
        $set: {
          slug: LEAD_SLUG,
          pendingHolderSweeps: [
            {
              roleId: role._id,
              previousSlug: EDITOR_SLUG,
              actorId: fixture.roleActorId,
            },
          ],
        },
      },
    );
    const gate = new RaceGate();
    const find = h.roleModel.collection.find.bind(h.roleModel.collection);
    jest.spyOn(h.roleModel.collection, 'find').mockImplementation((...args) => {
      const cursor = find(...args);
      if ('pendingHolderSweeps.0' in args[0]) {
        const read = cursor.toArray.bind(cursor);
        jest.spyOn(cursor, 'toArray').mockImplementationOnce(async () => {
          await gate.hold();
          return read();
        });
      }
      return cursor;
    });
    const first = instance();
    const second = instance();
    const completed = new RaceGate();
    const finished = finishBootstrap([first, second], () => {
      void completed.hold();
    });
    try {
      const reached = await Promise.race([
        gate.reached(2).then(() => true),
        completed.reached().then(() => false),
      ]);
      if (!reached)
        throw new Error(
          JSON.stringify({
            phase: 'startup discovery',
            roles: await h.roleModel.find().lean(),
            holder: await h.users.findById(target._id).lean(),
          }),
        );
    } finally {
      gate.release();
      completed.release();
      await finished;
    }
    expect((await h.users.findById(target._id))?.role).toBe(LEAD_SLUG);
    expect((await h.users.findById(target._id))?.sessionVersion).toBe(1);
    const events = await h.events
      .find({ targetUserId: target._id.toString() })
      .lean();
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(fixture.roleActorId);
    expect((await h.roleModel.findById(role._id))?.pendingHolderSweeps).toEqual(
      [],
    );
  });

  it('keeps startup sweep work when its commit answer is unknown', async () => {
    const { h } = fixture;
    const target = await fixture.seed(
      'bootstrap-unknown@example.test',
      EDITOR_SLUG,
    );
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    await h.roleModel.updateOne(
      { _id: role._id },
      {
        $set: {
          slug: LEAD_SLUG,
          pendingHolderSweeps: [
            {
              roleId: role._id,
              previousSlug: EDITOR_SLUG,
              actorId: fixture.roleActorId,
              sweepId: 'startup-unknown-sweep',
            },
          ],
        },
      },
    );
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
            throw new MongoNetworkError('startup sweep answer unavailable');
          });
        return session;
      });
    const log = jest.spyOn(Logger.prototype, 'error');

    await expect(finishBootstrap([instance()])).resolves.toBeUndefined();

    expect((await h.users.findById(target._id))?.role).toBe(LEAD_SLUG);
    expect(
      (await h.roleModel.findById(role._id))?.pendingHolderSweeps,
    ).toHaveLength(1);
    expect(log).toHaveBeenCalledWith({
      event: ROLE_SWEEP_PENDING,
      roleId: role._id.toString(),
      previousSlug: EDITOR_SLUG,
      actorId: fixture.roleActorId,
      error: 'name=UnknownTransactionOutcomeError cause=name=MongoNetworkError',
    });
  });

  it('repairs a delete that crashed before transferring its reference to the default role', async () => {
    const { h } = fixture;
    const target = await fixture.seed(
      'bootstrap-delete@example.test',
      UserRole.MANAGER,
    );
    await fixture.assign(target._id.toString());
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    await withMajorityTransaction(h.connection, async (session) => {
      await h.app.get(SecurityEventService).recordRoleDeletion(
        {
          roleId: role._id.toString(),
          previousSlug: EDITOR_SLUG,
          actorId: fixture.roleActorId,
        },
        session,
      );
      await h.roleModel.deleteOne({ _id: role._id }, { session }).exec();
    });
    const bootstrap = instance();
    await finishBootstrap([bootstrap]);
    expect((await h.users.findById(target._id))?.role).toBe(UserRole.MANAGER);
    expect((await h.users.findById(target._id))?.sessionVersion).toBe(2);
    const events = await h.events
      .find({ targetUserId: target._id.toString() })
      .sort({ _id: 1 })
      .lean();
    expect(events).toHaveLength(2);
    expect(events[1].actorId).toBe(fixture.roleActorId);
    expect(
      (
        await h.events.findOne({
          'roleDeletionSweep.roleId': role._id.toString(),
        })
      )?.roleDeletionSweep?.pending,
    ).toBe(false);
    await finishBootstrap([bootstrap]);
    expect(
      await h.events.countDocuments({ targetUserId: target._id.toString() }),
    ).toBe(2);
    expect((await h.users.findById(target._id))?.sessionVersion).toBe(2);
  });
  it('retains a failed delete repair and attempts its recorded reference only once per startup', async () => {
    const { h } = fixture;
    const target = await fixture.seed(
      'bootstrap-failed-delete@example.test',
      UserRole.MANAGER,
    );
    await fixture.assign(target._id.toString());
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    const ref = {
      roleId: role._id,
      previousSlug: EDITOR_SLUG,
      actorId: fixture.roleActorId,
      sweepId: 'failed-delete-operation',
    };
    await withMajorityTransaction(h.connection, async (session) => {
      await h.app
        .get(SecurityEventService)
        .recordRoleDeletion({ ...ref, roleId: role._id.toString() }, session);
      await h.roleModel
        .updateOne(
          { slug: UserRole.USER },
          { $push: { pendingHolderSweeps: ref } },
          { session },
        )
        .exec();
      await h.roleModel.deleteOne({ _id: role._id }, { session }).exec();
    });
    const failure = new MongoNetworkError('startup sweep unavailable');
    jest
      .spyOn(h.roleModel.collection, 'findOne')
      .mockRejectedValueOnce(failure);
    const log = jest.spyOn(Logger.prototype, 'error');
    const bootstrap = instance();
    await expect(finishBootstrap([bootstrap])).resolves.toBeUndefined();
    expect((await h.users.findById(target._id))?.role).toBe(EDITOR_SLUG);
    expect((await h.users.findById(target._id))?.sessionVersion).toBe(1);
    expect(
      await h.events.countDocuments({ targetUserId: target._id.toString() }),
    ).toBe(1);
    expect(
      (await h.roleModel.findOne({ slug: UserRole.USER }))?.pendingHolderSweeps,
    ).toHaveLength(1);
    expect(
      (
        await h.events.findOne({
          'roleDeletionSweep.roleId': role._id.toString(),
        })
      )?.roleDeletionSweep?.pending,
    ).toBe(true);
    expect(log.mock.calls).toEqual([
      [
        {
          event: ROLE_SWEEP_PENDING,
          roleId: role._id.toString(),
          previousSlug: EDITOR_SLUG,
          actorId: fixture.roleActorId,
          error: 'name=MongoNetworkError',
        },
      ],
    ]);
  });
});
