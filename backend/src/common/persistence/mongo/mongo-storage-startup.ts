import { Injectable, Provider } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  PersistenceTimeoutError,
  PersistenceUnavailableError,
  UniqueConflictError,
} from '../persistence-errors';
import { StorageNotReadyError, StorageStartup } from '../storage-startup';
import { retryStorageStartup } from '../storage-startup-retry';
import { mapMongoDriverError } from './mongo-driver-errors';

/**
 * The schemas declare the indexes, and this adapter builds them before the
 * application serves. It asks the connection for its models, so a model a
 * module registers is covered without being named here. Building an index
 * that is already there changes nothing.
 *
 * Migrations are applied by an operator with `migrate-mongo`. The server has
 * never read their record at start and does not here: it neither applies a
 * migration nor refuses to start over one.
 *
 * An index that cannot be built is a `StorageNotReadyError` naming the
 * collection, with the driver's error as its cause. A database that went away
 * during the build leaves as the shared outage error.
 */
@Injectable()
export class MongoStorageStartup extends StorageStartup {
  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
  }

  async prepare(): Promise<void> {
    await retryStorageStartup(() =>
      Promise.all(
        this.connection.modelNames().map((name) => this.buildIndexes(name)),
      ).then(() => undefined),
    );
  }

  /** Waits out the build Mongoose started itself, then puts back what is lost. */
  private async buildIndexes(name: string): Promise<void> {
    const model = this.connection.model(name);
    try {
      await model.init();
      await model.createIndexes();
    } catch (error) {
      throw indexBuildRefusal(model.collection.collectionName, error);
    }
  }
}

function indexBuildRefusal(collection: string, error: unknown): unknown {
  const mapped = mapMongoDriverError(error);
  if (
    mapped instanceof PersistenceUnavailableError ||
    mapped instanceof PersistenceTimeoutError
  ) {
    return mapped;
  }
  if (mapped instanceof UniqueConflictError) {
    return new StorageNotReadyError(
      `MongoDB could not build the unique index "${mapped.constraint}" on the collection "${collection}", because stored documents break its rule. Remove or repair them, then start again.`,
      error,
    );
  }
  return new StorageNotReadyError(
    `MongoDB could not build the indexes of the collection "${collection}". The cause says why. Repair the collection, then start again.`,
    error,
  );
}

export const MONGO_STORAGE_STARTUP: Provider = {
  provide: StorageStartup,
  useClass: MongoStorageStartup,
};
