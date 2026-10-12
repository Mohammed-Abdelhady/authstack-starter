import { Logger } from '@nestjs/common';
import { ClientSessionOptions, Types } from 'mongoose';
import { MongoNetworkError } from 'mongodb';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { ROLE_SWEEP_PENDING } from '../../../../../common/constants/roles';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

describe('committed role sweep failure logging', () => {
  const fixture = useAdminRoundFour('round_five_sweep_log');

  it('logs safe driver facts when both the sweep and recording its reference fail', async () => {
    const { h } = fixture;
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    const target = await fixture.seed('pending-log@example.test', EDITOR_SLUG);
    await fixture.assign(target._id.toString(), UserRole.USER);
    const start = h.connection.startSession.bind(h.connection);
    let committed = false;
    jest
      .spyOn(h.connection, 'startSession')
      .mockImplementationOnce(async (options?: ClientSessionOptions) => {
        const session = await start(options);
        const commit = session.commitTransaction.bind(session);
        jest
          .spyOn(session, 'commitTransaction')
          .mockImplementationOnce(async () => {
            await commit();
            await h.users.collection.updateOne(
              { _id: target._id },
              { $set: { role: EDITOR_SLUG } },
            );
            committed = true;
          });
        return session;
      });
    const read = h.roleModel.collection.findOne.bind(h.roleModel.collection);
    jest
      .spyOn(h.roleModel.collection, 'findOne')
      .mockImplementation(async (...args) => {
        if (
          committed &&
          args[0]?._id instanceof Types.ObjectId &&
          args[0]._id.equals(role._id)
        )
          throw new MongoNetworkError('sweep failed for private@example.test');
        return read(...args);
      });
    const write = h.roleModel.collection.updateOne.bind(h.roleModel.collection);
    jest
      .spyOn(h.roleModel.collection, 'updateOne')
      .mockImplementation(async (...args) => {
        if (committed && !Array.isArray(args[1]) && args[1]?.$push)
          throw new MongoNetworkError('reference failed for Private Name');
        return write(...args);
      });
    const log = jest.spyOn(Logger.prototype, 'error');
    await expect(
      h.roles.delete(EDITOR_SLUG, fixture.roleActorId),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith({
      event: ROLE_SWEEP_PENDING,
      roleId: role._id.toString(),
      previousSlug: EDITOR_SLUG,
      actorId: fixture.roleActorId,
      error: 'name=MongoNetworkError',
      pendingRecordError: 'name=MongoNetworkError',
    });
    expect((await h.users.findById(target._id))?.role).toBe(EDITOR_SLUG);
    expect(
      (await h.roleModel.findOne({ slug: UserRole.USER }))?.pendingHolderSweeps,
    ).toEqual([]);
    expect(
      (
        await h.events.findOne({
          'roleDeletionSweep.roleId': role._id.toString(),
        })
      )?.roleDeletionSweep?.pending,
    ).toBe(true);
  });
});
