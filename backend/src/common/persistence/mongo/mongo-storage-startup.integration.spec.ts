import { Connection, createConnection, Schema } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../test/utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { MongoStorageStartup } from './mongo-storage-startup';
import { PersistenceUnavailableError } from '../persistence-errors';
import { StorageNotReadyError } from '../storage-startup';

const DUPLICATE_KEY = 11000;

/** How `prepare` ended: ready, or the code and message it was refused with. */
async function preparedOn(
  connection: Connection,
  collection: string,
): Promise<unknown> {
  try {
    await new MongoStorageStartup(connection).prepare();
  } catch (error) {
    const failure = error instanceof StorageNotReadyError ? error.cause : error;
    const code: unknown = Reflect.get(Object(failure), 'code');
    return {
      code,
      namesTheCollection:
        error instanceof Error && error.message.includes(collection),
    };
  }
  return 'ready';
}

describe('MongoStorageStartup with an index that cannot be built', () => {
  let mongo: MemoryReplSet | undefined;
  let connection: Connection | undefined;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(
      mongo.uri('storage_startup_index_failure'),
    ).asPromise();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it.each([
    // Mongoose builds the index itself when the model is registered.
    ['Mongoose builds on registration', 'startup_badges', true],
    // Nothing builds it before start-up does.
    ['only start-up builds', 'startup_tokens', false],
  ])(
    'refuses to start over stored duplicates of a unique rule and names the collection, when %s',
    async (_, collection, autoIndex) => {
      if (!connection) throw new Error('the MongoDB connection did not open');
      const models = connection.useDb(`startup_${collection}`, {
        useCache: false,
      });
      // Two documents the unique rule below cannot hold together.
      await models
        .collection(collection)
        .insertMany([{ serial: 'same' }, { serial: 'same' }]);
      models.model(
        collection,
        new Schema(
          { serial: { type: String, unique: true } },
          { collection, autoIndex },
        ),
      );

      expect(await preparedOn(models, collection)).toEqual({
        code: DUPLICATE_KEY,
        namesTheCollection: true,
      });
    },
  );

  it('builds real indexes after one transient connection failure', async () => {
    if (!connection) throw new Error('the MongoDB connection did not open');
    const models = connection.useDb('startup_retry', { useCache: false });
    const model = models.model(
      'startup_retry',
      new Schema(
        { serial: { type: String, unique: true } },
        { collection: 'startup_retry', autoIndex: false },
      ),
    );
    const indexes = jest
      .spyOn(model, 'createIndexes')
      .mockRejectedValueOnce(new PersistenceUnavailableError());
    try {
      await expect(
        new MongoStorageStartup(models).prepare(),
      ).resolves.toBeUndefined();
      expect(indexes).toHaveBeenCalledTimes(2);
      const names = (await models.collection('startup_retry').indexes()).map(
        (index) => index.name,
      );
      expect(names).toContain('serial_1');
    } finally {
      indexes.mockRestore();
    }
  });
});
