import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { bootSessionAuthority } from '../../../../test/utils/session-authority-harness';
import { StorageStartupHarness } from '../../../../test/utils/startup/storage-startup-contract';
import { StorageStartup } from '../storage-startup';

const DUPLICATE_KEY = 11000;
const CHANGELOG = 'migrations';

export async function bootMongoStartupHarness(): Promise<StorageStartupHarness> {
  const mongo = await startMemoryReplSet();
  const booted = await bootSessionAuthority(
    mongo.uri('storage_startup_contract'),
    new FrozenClock(TEST_NOW),
  );
  const { app, sessions, connection } = booted;
  let credentials = 0;

  return {
    startup: app.get(StorageStartup),
    refusesDuplicateCredential: async () => {
      credentials += 1;
      const session = { tokenHash: `credential-${credentials}`, isValid: true };
      await sessions.collection.insertOne({ ...session });
      try {
        await sessions.collection.insertOne({ ...session });
      } catch (error) {
        return (
          typeof error === 'object' &&
          error !== null &&
          Reflect.get(error, 'code') === DUPLICATE_KEY
        );
      }
      return false;
    },
    loseCredentialRule: async () => {
      await sessions.collection.dropIndex('tokenHash_unique');
      return true;
    },
    // This adapter reads no migration record: see its own comment.
    behindThisBuild: () => null,
    aheadOfThisBuild: () => null,
    migrationRecord: async () => {
      const applied = await connection
        .collection(CHANGELOG)
        .find({})
        .sort({ fileName: 1 })
        .toArray();
      return applied.map((entry) => String(entry.fileName));
    },
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}
