import { Logger } from '@nestjs/common';
import { ClientSessionOptions, Types } from 'mongoose';
import { MongoNetworkError } from 'mongodb';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { ROLE_SWEEP_PENDING } from '../../../../../common/constants/roles';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import {
  EDITOR_SLUG,
  LEAD_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

const OPERATIONS = ['rename', 'delete'] as const;

describe('committed role operations retain pending sweep work', () => {
  const fixture = useAdminRoundFour('round_five_recovery');
  for (const operation of OPERATIONS) {
    it(`answers success after ${operation} commits and resumes its failed sweep on a later edit`, async () => {
      const { h } = fixture;
      const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
      const target = await fixture.seed('pending@example.test', EDITOR_SLUG);
      if (operation === 'delete') {
        await fixture.assign(target._id.toString(), UserRole.USER);
      }
      const failure = new MongoNetworkError('sweep disconnected');
      const log = jest.spyOn(Logger.prototype, 'error');
      const start = h.connection.startSession.bind(h.connection);
      let failSweep = false;
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
              failSweep = true;
            });
          return session;
        });
      const find = h.roleModel.collection.findOne.bind(h.roleModel.collection);
      jest
        .spyOn(h.roleModel.collection, 'findOne')
        .mockImplementation(async (...args) => {
          if (
            failSweep &&
            args[0]?._id instanceof Types.ObjectId &&
            args[0]._id.equals(role._id)
          ) {
            failSweep = false;
            throw failure;
          }
          return find(...args);
        });
      if (operation === 'rename') {
        const answer = await h.roles.update(
          EDITOR_SLUG,
          { name: 'Content Lead' },
          fixture.roleActorId,
        );
        expect(answer.slug).toBe(LEAD_SLUG);
        failSweep = false;
      } else {
        await expect(
          h.roles.delete(EDITOR_SLUG, fixture.roleActorId),
        ).resolves.toBeUndefined();
        failSweep = false;
        expect(await h.roleModel.findById(role._id)).toBeNull();
      }
      expect((await h.users.findById(target._id))?.role).toBe(EDITOR_SLUG);
      const owner = await h.roleModel
        .findOne({ slug: operation === 'rename' ? LEAD_SLUG : UserRole.USER })
        .orFail();
      expect(owner.pendingHolderSweeps).toHaveLength(1);
      expect(log).toHaveBeenCalledWith({
        event: ROLE_SWEEP_PENDING,
        roleId: role._id.toString(),
        previousSlug: EDITOR_SLUG,
        actorId: fixture.roleActorId,
        error: 'name=MongoNetworkError',
      });
      const pendingLogs = log.mock.calls.filter(([message]) => {
        const entry: unknown = message;
        return (
          typeof entry === 'object' &&
          entry !== null &&
          'event' in entry &&
          entry.event === ROLE_SWEEP_PENDING
        );
      });
      expect(pendingLogs).toHaveLength(1);
      const retry = await h.roles.update(
        owner._id.toString(),
        { description: 'Resume pending sweep' },
        fixture.roleActorId,
      );
      expect(retry.usersMoved).toBe(1);
      expect(
        (await h.roleModel.findById(owner._id))?.pendingHolderSweeps,
      ).toHaveLength(0);
      const stored = await h.users.findById(target._id);
      expect(stored?.role).toBe(
        operation === 'rename' ? LEAD_SLUG : UserRole.USER,
      );
      expect(stored?.sessionVersion).toBe(2);
      const events = await h.events
        .find({ targetUserId: target._id.toString() })
        .sort({ _id: 1 })
        .lean();
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        actorId: fixture.roleActorId,
        reasonCode: REVOKED_REASON.ADMIN_FORCED,
      });
    });
  }

  it('answers unknown after a landed rename and keeps its sweep for recovery', async () => {
    const { h } = fixture;
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    const target = await fixture.seed('unknown-rename@example.test');
    expect(target.role).toBe(UserRole.USER);
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
            throw new MongoNetworkError('commit response unavailable');
          });
        return session;
      });

    await expect(
      h.roles.update(
        EDITOR_SLUG,
        { name: 'Content Lead' },
        fixture.roleActorId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
      status: 503,
    });
    expect((await h.roleModel.findById(role._id))?.slug).toBe(LEAD_SLUG);
    expect(
      (await h.roleModel.findById(role._id))?.pendingHolderSweeps,
    ).toHaveLength(1);
    const storedTarget = await h.users.findById(target._id);
    const roleHistory = await h.events
      .find({ targetUserId: target._id.toString() })
      .sort({ _id: 1 })
      .lean();
    expect({ role: storedTarget?.role, roleHistory }).toEqual({
      role: UserRole.USER,
      roleHistory: [],
    });

    await h.roles.update(
      LEAD_SLUG,
      { description: 'Resume uncertain rename repair' },
      fixture.roleActorId,
    );
    expect(
      (await h.roleModel.findById(role._id))?.pendingHolderSweeps,
    ).toHaveLength(0);
  });

  it('keeps a pending sweep and logs a lost sweep commit answer safely', async () => {
    const { h } = fixture;
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    await fixture.seed('unknown-sweep@example.test');
    const start = h.connection.startSession.bind(h.connection);
    let sessionNumber = 0;
    jest
      .spyOn(h.connection, 'startSession')
      .mockImplementation(async (options?: ClientSessionOptions) => {
        const session = await start(options);
        sessionNumber += 1;
        const number = sessionNumber;
        const commit = session.commitTransaction.bind(session);
        jest
          .spyOn(session, 'commitTransaction')
          .mockImplementation(async () => {
            await commit();
            if (number === 2) {
              throw new MongoNetworkError('sweep commit answer unavailable');
            }
          });
        return session;
      });
    const log = jest.spyOn(Logger.prototype, 'error');

    const answer = await h.roles.update(
      EDITOR_SLUG,
      { name: 'Content Lead' },
      fixture.roleActorId,
    );

    expect(answer.slug).toBe(LEAD_SLUG);
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

  it('retains bounded repair work and resumes it on a same-name edit', async () => {
    const { h } = fixture;
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    await fixture.seed('initial-holder@example.test', EDITOR_SLUG);
    const start = h.connection.startSession.bind(h.connection);
    let commits = 0;
    let inject = true;
    jest
      .spyOn(h.connection, 'startSession')
      .mockImplementation(async (options?: ClientSessionOptions) => {
        const session = await start(options);
        const commit = session.commitTransaction.bind(session);
        jest
          .spyOn(session, 'commitTransaction')
          .mockImplementation(async () => {
            await commit();
            commits += 1;
            if (inject)
              await h.users.collection.insertOne({
                email: `late-${commits}@example.test`,
                name: 'Late holder',
                role: EDITOR_SLUG,
                isVerified: true,
                isDeleted: false,
                sessionVersion: 0,
              });
          });
        return session;
      });
    const log = jest.spyOn(Logger.prototype, 'error');
    const answer = await h.roles.update(
      EDITOR_SLUG,
      { name: 'Content Lead' },
      fixture.roleActorId,
    );
    inject = false;
    expect(answer.slug).toBe(LEAD_SLUG);
    expect(answer.usersMoved).toBe(4);
    expect(await h.users.countDocuments({ role: EDITOR_SLUG })).toBe(1);
    expect(
      (await h.roleModel.findById(role._id))?.pendingHolderSweeps,
    ).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ROLE_SWEEP_PENDING,
        roleId: role._id.toString(),
        previousSlug: EDITOR_SLUG,
        actorId: fixture.roleActorId,
      }),
    );
    const repaired = await h.roles.update(
      LEAD_SLUG,
      { name: 'Content Lead' },
      fixture.roleActorId,
    );
    expect(repaired.usersMoved).toBe(1);
    expect(await h.users.countDocuments({ role: EDITOR_SLUG })).toBe(0);
    expect(
      (await h.roleModel.findById(role._id))?.pendingHolderSweeps,
    ).toHaveLength(0);
    const holder = await h.users
      .findOne({ email: 'late-4@example.test' })
      .orFail();
    expect(holder.role).toBe(LEAD_SLUG);
    expect(holder.sessionVersion).toBe(1);
    expect(
      await h.events.countDocuments({ targetUserId: holder._id.toString() }),
    ).toBe(1);
  });
});
