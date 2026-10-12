import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { type Connection } from 'mongoose';
import { MongoStorageStartup } from '../../src/common/persistence/mongo/mongo-storage-startup';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const NAMESPACE_NOT_FOUND = 26;
/** Models every generated project has, whatever features it was built with. */
const CORE_MODELS = ['Application', 'Role', 'SecurityEvent', 'Session', 'User'];

async function storedIndexKeys(
  connection: Connection,
  name: string,
): Promise<string[]> {
  try {
    const stored = await connection.model(name).collection.indexes();
    return stored.map((index) => JSON.stringify(index.key));
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'code') === NAMESPACE_NOT_FOUND
    ) {
      return [];
    }
    throw error;
  }
}

/** Every declared index the database does not hold, as `Model {key}`. */
async function missingIndexes(connection: Connection): Promise<string[]> {
  const missing: string[] = [];
  for (const name of connection.modelNames().sort()) {
    const stored = await storedIndexKeys(connection, name);
    for (const [fields] of connection.model(name).schema.indexes()) {
      const key = JSON.stringify(fields);
      if (!stored.includes(key)) missing.push(`${name} ${key}`);
    }
  }
  return missing;
}

/**
 * Mongoose's own background builds are switched off here, so an index exists
 * when the store has been prepared only if preparing it built that index.
 */
describe('the indexes in place when the store has been prepared', () => {
  let e2e: E2eApp | undefined;
  let restore: (() => void) | undefined;
  let registered: string[] = [];
  let missing: string[] | undefined;

  beforeAll(async () => {
    const autoIndex = mongoose.get('autoIndex');
    const autoCreate = mongoose.get('autoCreate');
    const prepare: unknown = Reflect.get(
      MongoStorageStartup.prototype,
      'prepare',
    );
    if (typeof prepare !== 'function') {
      throw new Error('the start-up adapter has no prepare step');
    }
    restore = () => {
      mongoose.set('autoIndex', autoIndex);
      mongoose.set('autoCreate', autoCreate);
      Reflect.set(MongoStorageStartup.prototype, 'prepare', prepare);
    };
    mongoose.set('autoIndex', false);
    mongoose.set('autoCreate', false);
    Reflect.set(
      MongoStorageStartup.prototype,
      'prepare',
      async function (this: MongoStorageStartup): Promise<void> {
        await Reflect.apply(prepare, this, []);
        if (missing !== undefined) return;
        const connection: unknown = Reflect.get(this, 'connection');
        if (!(connection instanceof mongoose.Connection)) {
          throw new Error('the start-up adapter holds no connection');
        }
        registered = connection.modelNames();
        missing = await missingIndexes(connection);
      },
    );

    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    restore?.();
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('has every index a registered model declares, with nothing left to build', () => {
    expect(missing).toEqual([]);
  });

  it('has seen the models of every module by the time it prepares the store', () => {
    const application = e2e?.app.get<Connection>(getConnectionToken());

    expect(registered).toEqual(expect.arrayContaining(CORE_MODELS));
    expect([...registered].sort()).toEqual(application?.modelNames().sort());
  });
});
