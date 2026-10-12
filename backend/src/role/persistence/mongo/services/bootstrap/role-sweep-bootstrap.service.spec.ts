import { Logger } from '@nestjs/common';
import { MongoClient, MongoNetworkError } from 'mongodb';
import { Mongoose } from 'mongoose';
import { Role, RoleSchema, RoleDocument } from '../../schemas/role.schema';
import {
  User,
  UserSchema,
  UserDocument,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import {
  SecurityEvent,
  SecurityEventSchema,
  SecurityEventDocument,
} from '../../../../../session/persistence/mongo/schemas/security-event.schema';
import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import {
  ROLE_SWEEP_BOOTSTRAP_FAILED,
  ROLE_SWEEP_BOOTSTRAP_BUDGET_EXHAUSTED,
} from '../../../../../common/constants/roles';
import { finishBootstrap } from '../../../../services/bootstrap/role-bootstrap.harness-spec';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import { mongoRoleSweepBootstrap } from '../../../../../../test/utils/role/mongo-role-services';

describe('startup repair discovery failure', () => {
  afterEach(() => jest.restoreAllMocks());
  it('returns immediately, bounds discovery and logs an asynchronous failure without throwing', async () => {
    const mongoose = new Mongoose();
    mongoose.set('autoCreate', false);
    mongoose.set('autoIndex', false);
    mongoose.set('bufferCommands', false);
    mongoose.model(Role.name, RoleSchema.clone());
    mongoose.model(User.name, UserSchema.clone());
    mongoose.model(SecurityEvent.name, SecurityEventSchema.clone());
    const roles = mongoose.model<RoleDocument>(Role.name);
    const users = mongoose.model<UserDocument>(User.name);
    const events = new SecurityEventService(
      mongoose.model<SecurityEventDocument>(SecurityEvent.name),
      new FrozenClock(TEST_NOW),
    );
    const failure = new MongoNetworkError(
      'startup scan failed for private@example.test',
    );
    const gate = new RaceGate();
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const cursor = client
      .db('disconnected_bootstrap')
      .collection('roles')
      .find();
    jest.spyOn(cursor, 'toArray').mockImplementation(async () => {
      await gate.hold();
      throw failure;
    });
    const find = jest.spyOn(roles.collection, 'find').mockReturnValue(cursor);
    const log = jest.spyOn(Logger.prototype, 'error');
    const bootstrap = mongoRoleSweepBootstrap(
      roles,
      users,
      mongoose.connection,
      events,
      new FrozenClock(TEST_NOW),
    );
    try {
      expect(bootstrap.onApplicationBootstrap()).toBeUndefined();
      const reached = await Promise.race([
        gate.reached().then(() => true),
        bootstrap.onApplicationShutdown().then(() => false),
      ]);
      expect(reached).toBe(true);
      expect(find.mock.calls[0][0]).toEqual({
        'pendingHolderSweeps.0': { $exists: true },
      });
      expect(find.mock.calls[0][1]).toEqual(
        expect.objectContaining({ limit: 16, maxTimeMS: 5000 }),
      );
    } finally {
      gate.release();
      try {
        await expect(
          bootstrap.onApplicationShutdown(),
        ).resolves.toBeUndefined();
      } finally {
        await client.close();
      }
    }
    expect(log).toHaveBeenCalledWith({
      event: ROLE_SWEEP_BOOTSTRAP_FAILED,
      error: 'name=MongoNetworkError',
    });
  });

  it.each([
    { elapsed: 29_999, eventScans: 1, budgetWarnings: 0 },
    { elapsed: 30_000, eventScans: 0, budgetWarnings: 1 },
  ])(
    'checks the overall budget at $elapsed ms after empty owner discovery',
    async ({ elapsed, eventScans, budgetWarnings }) => {
      const mongoose = new Mongoose();
      mongoose.set('autoCreate', false);
      mongoose.set('autoIndex', false);
      mongoose.set('bufferCommands', false);
      mongoose.model(Role.name, RoleSchema.clone());
      mongoose.model(User.name, UserSchema.clone());
      mongoose.model(SecurityEvent.name, SecurityEventSchema.clone());
      const roles = mongoose.model<RoleDocument>(Role.name);
      const users = mongoose.model<UserDocument>(User.name);
      const events = mongoose.model<SecurityEventDocument>(SecurityEvent.name);
      const clock = new FrozenClock(TEST_NOW);
      const client = new MongoClient('mongodb://127.0.0.1:27017');
      const ownerCursor = client
        .db('disconnected_budget')
        .collection('roles')
        .find();
      const eventCursor = client
        .db('disconnected_budget')
        .collection('events')
        .find();
      const gate = new RaceGate();
      jest.spyOn(ownerCursor, 'toArray').mockImplementation(async () => {
        await gate.hold();
        return [];
      });
      jest.spyOn(eventCursor, 'toArray').mockResolvedValue([]);
      jest.spyOn(roles.collection, 'find').mockReturnValue(ownerCursor);
      const scans = jest
        .spyOn(events.collection, 'find')
        .mockReturnValue(eventCursor);
      const warnings = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const bootstrap = mongoRoleSweepBootstrap(
        roles,
        users,
        mongoose.connection,
        new SecurityEventService(events, clock),
        clock,
      );
      const finished = finishBootstrap([bootstrap]);
      try {
        await gate.reached();
        clock.advance(elapsed);
      } finally {
        gate.release();
        await finished;
        await client.close();
      }
      expect(scans).toHaveBeenCalledTimes(eventScans);
      expect(warnings).toHaveBeenCalledTimes(budgetWarnings);
      if (budgetWarnings === 1)
        expect(warnings).toHaveBeenCalledWith({
          event: ROLE_SWEEP_BOOTSTRAP_BUDGET_EXHAUSTED,
          budgetMs: 30_000,
        });
    },
  );

  it('does not discover further work once shutdown begins during an in-flight read', async () => {
    const mongoose = new Mongoose();
    mongoose.set('autoCreate', false);
    mongoose.set('autoIndex', false);
    mongoose.set('bufferCommands', false);
    mongoose.model(Role.name, RoleSchema.clone());
    mongoose.model(User.name, UserSchema.clone());
    mongoose.model(SecurityEvent.name, SecurityEventSchema.clone());
    const roles = mongoose.model<RoleDocument>(Role.name);
    const users = mongoose.model<UserDocument>(User.name);
    const events = mongoose.model<SecurityEventDocument>(SecurityEvent.name);
    const clock = new FrozenClock(TEST_NOW);
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const cursor = client
      .db('disconnected_shutdown')
      .collection('roles')
      .find();
    const eventCursor = client
      .db('disconnected_shutdown')
      .collection('events')
      .find();
    const gate = new RaceGate();
    jest.spyOn(cursor, 'toArray').mockImplementation(async () => {
      await gate.hold();
      return [];
    });
    jest.spyOn(eventCursor, 'toArray').mockResolvedValue([]);
    jest.spyOn(roles.collection, 'find').mockReturnValue(cursor);
    const scans = jest
      .spyOn(events.collection, 'find')
      .mockReturnValue(eventCursor);
    const bootstrap = mongoRoleSweepBootstrap(
      roles,
      users,
      mongoose.connection,
      new SecurityEventService(events, clock),
      clock,
    );
    bootstrap.onApplicationBootstrap();
    try {
      await gate.reached();
      const shutdown = bootstrap.onApplicationShutdown();
      gate.release();
      await expect(shutdown).resolves.toBeUndefined();
    } finally {
      gate.release();
      await bootstrap.onApplicationShutdown();
      await client.close();
    }
    expect(scans).not.toHaveBeenCalled();
  });
});
