import { startMemoryReplSet } from '../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../test/utils/session-authority-harness';
import { Sessions } from '../../auth/services/sessions/sessions';
import { MongoIdFormat } from '../../common/persistence/mongo/mongo-id-format';
import { UserSessionsService } from './user-sessions.service';

// Cases: read-time parts, unchanged stored phrase, own sessions only, native defaults.
describe('session listing device parts', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('session_device_parts'),
      new FrozenClock(TEST_NOW),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (harness) await harness.app.close();
    if (mongo) await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('derives parts from retained agents and leaves stored names unchanged', async () => {
    const user = await createTestUser(
      harness.users,
      'device-parts@example.com',
    );
    const other = await createTestUser(
      harness.users,
      'other-device-parts@example.com',
    );
    await harness.sessionService.createSession(
      user._id,
      'okhttp/4.12.0',
      '203.0.113.10',
    );
    await harness.sessionService.createSession(
      other._id,
      'Firefox/140.0',
      '203.0.113.20',
    );
    await harness.sessions.updateOne(
      { user: user._id },
      { $set: { deviceName: 'Legacy phrase' } },
    );
    const listing = new UserSessionsService(
      harness.app.get(Sessions),
      new MongoIdFormat(),
    );
    const answer = await listing.getSessions(user._id.toString(), null);
    expect(
      answer.data?.sessions.map(({ deviceName, deviceParts }) => ({
        deviceName,
        deviceParts,
      })),
    ).toEqual([
      {
        deviceName: 'Legacy phrase',
        deviceParts: { kind: 'mobileApp', platformName: 'Android' },
      },
    ]);
  });
});
