import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { startMemoryReplSet } from '../utils/memory-replset';
import {
  bootSessionAuthority,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/session-authority-harness';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../src/session/persistence/mongo/schemas/security-event.schema';
import { SecurityEventService } from '../../src/session/persistence/mongo/security-event.service';
import { SecurityEventStore } from '../../src/session/events/security-event.store';

describe('activity MongoDB bridge and TTL', () => {
  let dispose: (() => Promise<void>) | undefined;
  let model: Model<SecurityEventDocument>;
  let bridge: SecurityEventService;
  let events: SecurityEventStore;
  let deleteTarget: (() => Promise<string>) | undefined;
  beforeAll(async () => {
    const mongo = await startMemoryReplSet();
    const clock = new FrozenClock(TEST_NOW);
    const harness = await bootSessionAuthority(
      mongo.uri('activity_bridge'),
      clock,
    );
    dispose = async () => {
      await harness.app.close();
      await mongo.stop();
    };
    model = harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
    events = harness.app.get(SecurityEventStore);
    deleteTarget = async () => {
      const target = await harness.users.create({
        name: 'Target',
        email: 'target@example.test',
      });
      const id = target._id.toString();
      await bridge.record({
        actorId: 'staff-1',
        targetUserId: id,
        action: 'account_deleted',
      });
      await harness.users.deleteOne({ _id: target._id });
      return id;
    };
    bridge = new SecurityEventService(
      model,
      clock,
      undefined,
      new ConfigService({ activity: { retentionDays: 365 } }),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    await model.deleteMany({});
  });
  afterAll(async () => {
    await dispose?.();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('refuses secret details through both bridge methods without persisting a partial batch', async () => {
    for (const field of [
      'password',
      'token',
      'code',
      'cookie',
      'headers',
      'mailBody',
    ]) {
      const input = {
        actorId: 'staff-1',
        action: 'account_updated',
        details: { [field]: 'sensitive-sentinel' },
      };
      await expect(bridge.record(input)).rejects.toThrow(TypeError);
      await expect(
        bridge.recordMany([
          { actorId: 'staff-1', action: 'account_deleted' },
          input,
        ]),
      ).rejects.toThrow(TypeError);
    }
    expect(await model.countDocuments({})).toBe(0);
  });

  it('keeps readable evidence after the target account is physically deleted', async () => {
    if (!deleteTarget) throw new Error('MongoDB did not start');
    const id = await deleteTarget();
    const result = await events.listActivity(
      { page: 1, limit: 10, target: id },
      TEST_NOW,
    );
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      targetUserId: id,
      action: 'account_deleted',
    });
  });

  it('writes configured staff retention and retains the existing TTL deadline index', async () => {
    await bridge.record({
      actorId: 'staff-1',
      targetUserId: 'target',
      action: 'account_deleted',
    });
    const [event] = await events.listRecentForUser('target', 1);
    expect(event.purgeAfter).toEqual(new Date('2100-01-01T12:00:00.000Z'));
    const indexes = await model.collection.indexes();
    const ttl = indexes.find((index) => index.key.purgeAfter === 1);
    expect(ttl?.expireAfterSeconds).toBe(0);
  });
});
