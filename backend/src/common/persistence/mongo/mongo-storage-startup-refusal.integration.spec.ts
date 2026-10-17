import { Mongoose, Schema } from 'mongoose';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  MemoryReplSet,
  startMemoryReplSet,
} from '../../../../test/utils/memory-replset';
import {
  bootSessionAuthority,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';
import { PersistenceUnavailableError } from '../persistence-errors';
import { StorageNotReadyError, StorageStartup } from '../storage-startup';
import { MongoStorageStartup } from './mongo-storage-startup';

const DUPLICATE_KEY = 11000;
const INDEX_OPTIONS_CONFLICT = 85;
const SHUTDOWN_IN_PROGRESS = 91;

async function refusalOf(prepare: Promise<void>): Promise<unknown> {
  try {
    await prepare;
  } catch (error) {
    return error;
  }
  return 'prepared';
}

function messageOf(refusal: unknown): string {
  return refusal instanceof Error ? refusal.message : '';
}

function causeCodeOf(refusal: unknown): unknown {
  const cause: unknown = refusal instanceof Error ? refusal.cause : undefined;
  return typeof cause === 'object' && cause !== null
    ? Reflect.get(cause, 'code')
    : undefined;
}

describe('MongoDB start-up when an index cannot be built', () => {
  describe('on a database whose documents break a unique rule', () => {
    let mongo: MemoryReplSet;
    let booted: SessionAuthorityHarness;

    beforeAll(async () => {
      mongo = await startMemoryReplSet();
      booted = await bootSessionAuthority(
        mongo.uri('storage_startup_refusal'),
        new FrozenClock(TEST_NOW),
      );
    }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await booted?.app.close();
      await mongo?.stop();
    }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

    it('refuses with the storage error that names the collection and the index, and keeps the driver error as its cause', async () => {
      const { sessions, app } = booted;
      await sessions.collection.dropIndex('tokenHash_unique');
      const session = { tokenHash: 'stored-twice', isValid: true };
      await sessions.collection.insertOne({ ...session });
      await sessions.collection.insertOne({ ...session });

      const refusal = await refusalOf(app.get(StorageStartup).prepare());

      expect(refusal).toBeInstanceOf(StorageNotReadyError);
      expect(messageOf(refusal)).toContain('"sessions"');
      expect(messageOf(refusal)).toContain('"tokenHash_unique"');
      expect(messageOf(refusal)).not.toContain('stored-twice');
      expect(causeCodeOf(refusal)).toBe(DUPLICATE_KEY);
    });
  });

  describe('for a failure the driver reports while building', () => {
    function startupWhoseBuildFailsWith(failure: unknown): MongoStorageStartup {
      const connection = new Mongoose().createConnection();
      const model = connection.model(
        'StartupRefusalProbe',
        new Schema({ value: String }),
        'startup_refusal_probes',
      );
      jest.spyOn(model, 'init').mockResolvedValue(new model());
      jest.spyOn(model, 'createIndexes').mockRejectedValue(failure);
      return new MongoStorageStartup(connection);
    }

    it('refuses with the storage error that names the collection when the reason is not a duplicate', async () => {
      const failure = Object.assign(new Error('index options differ'), {
        code: INDEX_OPTIONS_CONFLICT,
      });

      const refusal = await refusalOf(
        startupWhoseBuildFailsWith(failure).prepare(),
      );

      expect(refusal).toBeInstanceOf(StorageNotReadyError);
      expect(messageOf(refusal)).toContain('"startup_refusal_probes"');
      expect(refusal instanceof Error ? refusal.cause : undefined).toBe(
        failure,
      );
    });

    it('reports a database that went away as the shared outage error, not as a store to repair', async () => {
      const failure = Object.assign(new Error('shutting down'), {
        code: SHUTDOWN_IN_PROGRESS,
      });

      const refusal = await refusalOf(
        startupWhoseBuildFailsWith(failure).prepare(),
      );

      expect(refusal).toBeInstanceOf(PersistenceUnavailableError);
      expect(refusal instanceof Error ? refusal.cause : undefined).toBe(
        failure,
      );
    });
  });
});
