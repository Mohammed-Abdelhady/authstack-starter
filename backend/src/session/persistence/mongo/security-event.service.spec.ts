import { Mongoose, Types } from 'mongoose';
import { MongoClient, MongoNetworkError } from 'mongodb';
import { SecurityEventService } from './security-event.service';
import {
  SecurityEvent,
  SecurityEventSchema,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import { REVOKED_REASON } from '../../constants/revoked-reason';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';

describe('security event driver failure boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes assignment history to the insert and rejects when the driver cannot persist it', async () => {
    const schema = SecurityEventSchema.clone();
    schema.set('autoCreate', false);
    schema.set('autoIndex', false);
    schema.set('bufferCommands', false);
    const mongoose = new Mongoose();
    mongoose.model(SecurityEvent.name, schema);
    const model = mongoose.model<SecurityEventDocument>(SecurityEvent.name);
    const failure = new MongoNetworkError('event store unavailable');
    const insert = jest
      .spyOn(model.collection, 'insertMany')
      .mockRejectedValueOnce(failure);
    const service = new SecurityEventService(model, new FrozenClock(TEST_NOW));

    await expect(
      service.recordMany([
        {
          targetUserId: '000000000000000000000010',
          actorId: '000000000000000000000020',
          action: SECURITY_EVENT_ACTION.SESSIONS_REVOKED_ALL,
          reasonCode: REVOKED_REASON.ADMIN_FORCED,
          roleAssignment: {
            assignedRoleId: '000000000000000000000030',
            previousRoleId: '000000000000000000000040',
            sessionVersion: 1,
          },
        },
      ]),
    ).rejects.toBe(failure);
    expect(insert.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        targetUserId: '000000000000000000000010',
        actorId: '000000000000000000000020',
        occurredAt: TEST_NOW,
        roleAssignment: {
          assignedRoleId: '000000000000000000000030',
          previousRoleId: '000000000000000000000040',
          sessionVersion: 1,
        },
      }),
    ]);
  });
  it('writes the delete reference and actor in the supplied transaction', async () => {
    const schema = SecurityEventSchema.clone();
    schema.set('autoCreate', false);
    schema.set('autoIndex', false);
    schema.set('bufferCommands', false);
    const mongoose = new Mongoose();
    mongoose.model(SecurityEvent.name, schema);
    const model = mongoose.model<SecurityEventDocument>(SecurityEvent.name);
    const failure = new MongoNetworkError('delete event unavailable');
    const insert = jest
      .spyOn(model.collection, 'insertOne')
      .mockRejectedValueOnce(failure);
    const service = new SecurityEventService(model, new FrozenClock(TEST_NOW));
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const session = client.startSession();
    try {
      await expect(
        service.recordRoleDeletion(
          {
            roleId: '000000000000000000000030',
            previousSlug: 'content-editor',
            actorId: '000000000000000000000020',
            sweepId: 'delete-operation-one',
          },
          session,
        ),
      ).rejects.toBe(failure);
      expect(insert.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          eventId: 'role-deletion:000000000000000000000030',
          action: SECURITY_EVENT_ACTION.ROLE_DELETED,
          actorId: '000000000000000000000020',
          occurredAt: TEST_NOW,
          roleDeletionSweep: {
            roleId: '000000000000000000000030',
            previousSlug: 'content-editor',
            actorId: '000000000000000000000020',
            sweepId: 'delete-operation-one',
            pending: true,
          },
        }),
      );
      expect(insert.mock.calls[0][1]?.session).toBe(session);
    } finally {
      await session.endSession();
      await client.close();
    }
  });
  it('discovers a bounded batch of pending deletes through their event id prefix', async () => {
    const mongoose = new Mongoose();
    mongoose.set('autoCreate', false);
    mongoose.set('autoIndex', false);
    mongoose.set('bufferCommands', false);
    mongoose.model(SecurityEvent.name, SecurityEventSchema.clone());
    const model = mongoose.model<SecurityEventDocument>(SecurityEvent.name);
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const cursor = client
      .db('disconnected_discovery')
      .collection('events')
      .find();
    jest.spyOn(cursor, 'toArray').mockResolvedValue([]);
    const find = jest.spyOn(model.collection, 'find').mockReturnValue(cursor);
    try {
      const service = new SecurityEventService(
        model,
        new FrozenClock(TEST_NOW),
      );
      await expect(service.pendingRoleDeletions(16)).resolves.toEqual([]);
      expect(find.mock.calls[0][0]).toEqual({
        eventId: { $regex: '^role-deletion:' },
        'roleDeletionSweep.pending': true,
      });
      expect(find.mock.calls[0][1]).toEqual(
        expect.objectContaining({ limit: 16, maxTimeMS: 5000 }),
      );
    } finally {
      await client.close();
    }
  });
  it('hands the persisted delete reference to startup repair with every field intact', async () => {
    const mongoose = new Mongoose();
    mongoose.set('autoCreate', false);
    mongoose.set('autoIndex', false);
    mongoose.set('bufferCommands', false);
    mongoose.model(SecurityEvent.name, SecurityEventSchema.clone());
    const model = mongoose.model<SecurityEventDocument>(SecurityEvent.name);
    const client = new MongoClient('mongodb://127.0.0.1:27017');
    const session = client.startSession();
    const insert = jest
      .spyOn(model.collection, 'insertOne')
      .mockResolvedValueOnce({
        acknowledged: true,
        insertedId: new Types.ObjectId('000000000000000000000050'),
      });
    const cursor = client
      .db('disconnected_handoff')
      .collection('events')
      .find();
    jest.spyOn(cursor, 'toArray').mockImplementationOnce(() => {
      const inserted = insert.mock.calls[0][0];
      if (!inserted._id) throw new Error('Event insert omitted its id');
      return Promise.resolve([{ ...inserted, _id: inserted._id }]);
    });
    jest.spyOn(model.collection, 'find').mockReturnValue(cursor);
    try {
      const service = new SecurityEventService(
        model,
        new FrozenClock(TEST_NOW),
      );
      await service.recordRoleDeletion(
        {
          roleId: '000000000000000000000030',
          previousSlug: 'content-editor',
          actorId: '000000000000000000000020',
          sweepId: 'delete-operation-one',
        },
        session,
      );
      await expect(service.pendingRoleDeletions(16)).resolves.toEqual([
        {
          roleId: '000000000000000000000030',
          previousSlug: 'content-editor',
          actorId: '000000000000000000000020',
          sweepId: 'delete-operation-one',
          pending: true,
        },
      ]);
    } finally {
      await session.endSession();
      await client.close();
    }
  });
});
