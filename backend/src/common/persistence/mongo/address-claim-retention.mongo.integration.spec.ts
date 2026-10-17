import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import {
  bootMongoRetention,
  MongoRetentionHarness,
} from '../../../../test/utils/address-retention/mongo-retention-harness';
import { invitationRetentionCases } from '../../../../test/utils/address-retention/invitation-retention-cases'; // feature:invitations
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/hook-timeouts';
import { mongoSessionOf } from '../../../../src/session/persistence/mongo/mongo-unit-of-work';
import { RaceGate } from '../../../../test/utils/race-gate';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { ADDRESS_CLAIM_KIND } from '../address-ledger';

const requireMigration = createRequire(__filename);
const migration = requireMigration(
  '../../../../migrations/20261017000001-address-claim-expiry.js',
) as { up(db: Db): Promise<void>; down(db: Db): Promise<void> };
const ADDRESS = 'held@example.test';
const SHARED_OWNER = 'shared-owner';

interface LegacyClaim {
  _id: string;
  owner: string;
  kind: string;
  lapsesAt?: Date | null;
}

describe('private MongoDB retention server ownership', () => {
  it('keeps shared data available after an independent private TTL server stops', async () => {
    const shared = await startMemoryReplSet();
    const uri = shared.uri();
    const client = new MongoClient(uri);
    let privateHarness: MongoRetentionHarness | undefined;
    try {
      await client.connect();
      const markers = client.db().collection<{ _id: string }>('markers');
      await markers.insertOne({ _id: SHARED_OWNER });
      privateHarness = await bootMongoRetention();
      expect(privateHarness.connection.port).not.toBe(
        Number.parseInt(new URL(uri).port, 10),
      );
      expect(
        await privateHarness.connection.collection('markers').countDocuments(),
      ).toBe(0);
      await privateHarness.close();
      privateHarness = undefined;
      expect(await markers.findOne({ _id: SHARED_OWNER })).toEqual({
        _id: SHARED_OWNER,
      });
    } finally {
      try {
        await privateHarness?.close();
      } finally {
        try {
          await client.close();
        } finally {
          await shared.stop();
        }
      }
    }
  });
});

describe('MongoDB address-claim physical retention', () => {
  let h: MongoRetentionHarness;
  beforeAll(async () => {
    h = await bootMongoRetention();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await h?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await h.reset();
    await h.claims.createIndexes();
  });

  it('expires dated rows from the fresh schema while preserving live and unknown legacy expiries', async () => {
    const raw = h.connection.collection<LegacyClaim>('addressclaims');
    await raw.insertMany([
      {
        _id: 'expired@example.test',
        owner: 'orphan',
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        lapsesAt: h.past,
      },
      {
        _id: 'live@example.test',
        owner: 'live',
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        lapsesAt: h.liveAt,
      },
      {
        _id: 'null@example.test',
        owner: 'legacy',
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        lapsesAt: null,
      },
      {
        _id: 'missing@example.test',
        owner: 'legacy',
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
      },
    ]);
    await h.ttlPass();
    expect(
      (await raw.find({}).sort({ _id: 1 }).toArray()).map((row) => row._id),
    ).toEqual([
      'live@example.test',
      'missing@example.test',
      'null@example.test',
    ]);
    const ttl = (await raw.indexes()).filter(
      (index) => index.key.lapsesAt === 1,
    );
    expect(
      ttl.map(({ key, expireAfterSeconds }) => ({ key, expireAfterSeconds })),
    ).toEqual([{ key: { lapsesAt: 1 }, expireAfterSeconds: 0 }]);
  });

  it('upgrades an existing collection idempotently and down leaves its live data intact', async () => {
    const db = h.connection.getClient().db(h.connection.name);
    await h.claims.collection.dropIndex('lapsesAt_1');
    await h.claims.create([
      {
        _id: 'expired@example.test',
        owner: 'orphan',
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        lapsesAt: h.past,
      },
      {
        _id: 'live@example.test',
        owner: 'live',
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        lapsesAt: h.liveAt,
      },
    ]);
    await migration.up(db);
    await migration.up(db);
    await h.ttlPass();
    expect((await h.claims.find({})).map((row) => row._id)).toEqual([
      'live@example.test',
    ]);
    await migration.down(db);
    await migration.down(db);
    expect(
      (await h.claims.collection.indexes()).map((index) => index.name),
    ).toEqual(['_id_']);
    expect(await h.claims.countDocuments()).toBe(1);
  });

  // feature:invitations:start
  invitationRetentionCases(() => ({
    ...h,
    cleanup: () => h.ttlPass(),
    owners: async () =>
      (await h.claims.find({}).sort({ _id: 1 })).map((row) => row.owner),
  }));
  // feature:invitations:end

  it.each(['same-owner', 'replacement-owner'])(
    'keeps a live %s update after real TTL processes expired rows',
    async (owner) => {
      await h.claims.create({
        _id: ADDRESS,
        owner: 'same-owner',
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        lapsesAt: h.past,
      });
      const held = new RaceGate();
      const renewal = h.runner.run(async (work) => {
        expect(
          await h.ledger.claim(work, {
            address: ADDRESS,
            owner,
            kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
            now: h.past,
            lapsesAt: h.liveAt,
          }),
        ).toBe('claimed');
        await held.hold();
      });
      try {
        await held.reached();
        await h.ttlPass(async () => {
          held.release();
          await renewal;
        });
        await h.runner.run((work) =>
          h.ledger.release(work, { address: ADDRESS, owner: 'obsolete-owner' }),
        );
        expect(
          (await h.claims.find({ _id: ADDRESS }).lean()).map((row) => ({
            owner: row.owner,
            lapsesAt: row.lapsesAt,
          })),
        ).toEqual([{ owner, lapsesAt: h.liveAt }]);
      } finally {
        held.release();
        await renewal;
      }
    },
  );

  it('cannot delete an uncommitted account reservation or expose the inserted account address', async () => {
    const held = new RaceGate();
    const creator = h.runner.run(async (work) => {
      const result = await h.ledger.reserveForAccount(work, {
        address: ADDRESS,
        now: h.past,
      });
      if (result.status !== 'reserved') throw new Error('Reservation refused');
      await held.hold();
      const user = new h.users({ email: ADDRESS, name: 'Retained account' });
      await user.save({ session: mongoSessionOf(work) });
      await h.ledger.finishAccountReservation(work, result.reservation);
    });
    try {
      await held.reached();
      await h.ttlPass();
      expect(await h.claims.countDocuments({ _id: ADDRESS })).toBe(0);
      held.release();
      await creator;
      expect(await h.users.countDocuments({ email: ADDRESS })).toBe(1);
      expect(await h.claims.countDocuments({ _id: ADDRESS })).toBe(0);
      expect(
        await h.runner.run((work) =>
          h.ledger.isFree(work, { address: ADDRESS, now: h.liveAt }),
        ),
      ).toBe(false);
    } finally {
      held.release();
      await creator;
    }
  });
});
