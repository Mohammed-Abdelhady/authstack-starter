import { Db, MongoClient } from 'mongodb';
import { createRequire } from 'node:module';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const nodeRequire = createRequire(__filename);
const mailCounterExpiry = nodeRequire(
  '../../migrations/20261009000001-mail-counter-expiry.js',
) as {
  up: (db: Db, client?: unknown) => Promise<void>;
  down: (db: Db, client?: unknown) => Promise<void>;
};

const COLLECTION = 'mailcounters';
const TTL_INDEX = 'expiresAt_1';
const WINDOW_STARTED_AT = new Date('2099-01-01T12:00:00.000Z');
/** The window start plus the one-hour ceiling on a mail window. */
const BACKFILLED_EXPIRY = new Date('2099-01-01T13:00:00.000Z');
const EXISTING_EXPIRY = new Date('2099-01-01T12:15:00.000Z');

function counter(
  email: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    email,
    purpose: 'signup',
    mailedCodes: 3,
    windowStartedAt: WINDOW_STARTED_AT,
    ...overrides,
  };
}

describe('mail counter expiry migration', () => {
  let mongo: MemoryReplSet;
  let client: MongoClient;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    client = await MongoClient.connect(mongo.getUri());
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await client.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await client.db().dropDatabase();
  });

  async function ttlIndexes(): Promise<unknown[]> {
    const indexes = await client.db().collection(COLLECTION).indexes();
    return indexes
      .filter((index) => index.name === TTL_INDEX)
      .map((index) => ({
        key: index.key,
        expireAfterSeconds: index.expireAfterSeconds,
      }));
  }

  it('backfills the expiry, keeps the count and creates the TTL index', async () => {
    const counters = client.db().collection(COLLECTION);
    await counters.insertMany([
      counter('legacy@example.test'),
      counter('current@example.test', { expiresAt: EXISTING_EXPIRY }),
    ]);

    await mailCounterExpiry.up(client.db());

    const legacy = await counters.findOne({ email: 'legacy@example.test' });
    const current = await counters.findOne({ email: 'current@example.test' });
    expect({
      expiresAt: legacy?.expiresAt,
      mailedCodes: legacy?.mailedCodes,
      windowStartedAt: legacy?.windowStartedAt,
    }).toEqual({
      expiresAt: BACKFILLED_EXPIRY,
      mailedCodes: 3,
      windowStartedAt: WINDOW_STARTED_AT,
    });
    expect(current?.expiresAt).toEqual(EXISTING_EXPIRY);
    expect(await ttlIndexes()).toEqual([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]);
  });

  it('runs twice without changing the result', async () => {
    const counters = client.db().collection(COLLECTION);
    await counters.insertOne(counter('legacy@example.test'));

    await mailCounterExpiry.up(client.db());
    await mailCounterExpiry.up(client.db());

    const legacy = await counters.findOne({ email: 'legacy@example.test' });
    expect(legacy?.expiresAt).toEqual(BACKFILLED_EXPIRY);
    expect(await counters.countDocuments()).toBe(1);
    expect(await ttlIndexes()).toEqual([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]);
  });

  it('runs on a database that has no counters yet', async () => {
    await mailCounterExpiry.up(client.db());

    expect(await ttlIndexes()).toEqual([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]);
  });

  it('drops the index on down and leaves every counter in place', async () => {
    const counters = client.db().collection(COLLECTION);
    await counters.insertOne(counter('legacy@example.test'));
    await mailCounterExpiry.up(client.db());

    await mailCounterExpiry.down(client.db());
    await mailCounterExpiry.down(client.db());

    const legacy = await counters.findOne({ email: 'legacy@example.test' });
    expect(await ttlIndexes()).toEqual([]);
    expect(legacy?.mailedCodes).toBe(3);
    expect(legacy?.expiresAt).toEqual(BACKFILLED_EXPIRY);
  });
});
