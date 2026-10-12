import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import {
  bootSessionAuthority,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';
import {
  SecurityEvent,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { SecurityEventService } from './security-event.service';

const ROLE_ID = '65f0000000000000000000aa';

describe('security events recorded with a caller transaction', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let events: Model<SecurityEventDocument>;
  let service: SecurityEventService;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('security_event_bridge'),
      new FrozenClock(TEST_NOW),
    );
    events = harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
    service = harness.app.get(SecurityEventService);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.app.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await events.deleteMany({});
  });

  const recordAll = async (then: () => void): Promise<void> => {
    const session = await harness.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await service.record({ action: 'bridge.single' }, session);
        await service.recordMany(
          [{ action: 'bridge.batch-one' }, { action: 'bridge.batch-two' }],
          session,
        );
        await service.recordRoleDeletion(
          { roleId: ROLE_ID, previousSlug: 'editor', actorId: 'actor-1' },
          session,
        );
        then();
      });
    } finally {
      await session.endSession();
    }
  };
  const storedActions = async (): Promise<string[]> =>
    (await events.find({}).select('action').lean().exec())
      .map(({ action }) => action)
      .sort();

  it('stores every event when the caller commits', async () => {
    await recordAll(() => undefined);

    expect(await storedActions()).toEqual([
      'bridge.batch-one',
      'bridge.batch-two',
      'bridge.single',
      'role_deleted',
    ]);
  });

  it('stores no event when the caller aborts after recording them', async () => {
    const stop = new Error('the caller changed its mind');

    await expect(
      recordAll(() => {
        throw stop;
      }),
    ).rejects.toBe(stop);

    expect(await storedActions()).toEqual([]);
  });
});
