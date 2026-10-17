import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { Db } from 'mongodb';
import {
  BACKEND_TEST_MONGO_DATA_PREFIX,
  BACKEND_TEST_MONGO_URIS_ENV,
} from '../constants/mongo';
import type { SharedMongoServer } from './mongo/mongo-server-state';

const REPLICA_SET_NAME = 'rs0';
const DEFAULT_DATABASE_NAME = 'test';
const PORT_BASE = 20000;
const PORT_RANGE = 40000;
const PORT_STRIDE = 97;
const DATABASE_NAME_LIMIT = 63;
const SUITE_HASH_LENGTH = 16;
const DATABASE_HASH_LENGTH = 12;
const DATABASE_LABEL_LENGTH = 20;
const SERVER_SELECTION_TIMEOUT_MS = 5000;
// Flush test journals promptly without weakening majority acknowledgements.
const TEST_JOURNAL_COMMIT_INTERVAL_MS = 1;

let fixtureSequence = 0;

export interface MemoryReplSet {
  uri: (dbName?: string) => string;
  getUri: (dbName?: string) => string;
  databaseName: (dbName?: string) => string;
  stop: () => Promise<void>;
}

export function startMemoryReplSet(): Promise<MemoryReplSet> {
  const mongoUris = readSharedMongoUris();
  if (mongoUris.length === 0) {
    throw new Error('The shared Jest MongoDB instance is not running');
  }

  const suitePath = expect.getState().testPath;
  if (!suitePath) {
    throw new Error('The current Jest suite path is unavailable');
  }

  const baseUri = mongoUris[(readWorkerId() - 1) % mongoUris.length];
  const fixtureId = fixtureSequence++;
  const suiteHash = createHash('sha256')
    .update(suitePath)
    .digest('hex')
    .slice(0, SUITE_HASH_LENGTH);
  const databases = new Set<string>();
  let stopped = false;

  const databaseName = (dbName?: string): string => {
    if (stopped) {
      throw new Error('This Jest MongoDB fixture has been stopped');
    }
    const requestedName = dbName || DEFAULT_DATABASE_NAME;
    const scopedName = scopedDatabaseName(suiteHash, fixtureId, requestedName);
    databases.add(scopedName);
    return scopedName;
  };

  const uri = (dbName?: string): string => {
    const parsed = new URL(baseUri);
    parsed.pathname = `/${databaseName(dbName)}`;
    parsed.searchParams.set('replicaSet', REPLICA_SET_NAME);
    return parsed.toString();
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (databases.size === 0) return;

    const client = new MongoClient(baseUri);
    await client.connect();
    try {
      for (const databaseName of databases) {
        await client.db(databaseName).dropDatabase();
      }
    } finally {
      await client.close();
    }
  };

  return Promise.resolve({ uri, getUri: uri, databaseName, stop });
}

export async function startSharedMongoServer(
  instanceIndex = 0,
  options: { port?: number; ttlMonitorSleepSecs?: number } = {},
): Promise<SharedMongoServer> {
  const dataPath = await mkdtemp(
    join(tmpdir(), `${BACKEND_TEST_MONGO_DATA_PREFIX}${process.pid}-`),
  );
  const preferredPort =
    PORT_BASE + ((process.pid + instanceIndex * PORT_STRIDE) % PORT_RANGE);
  let mongo: MongoMemoryServer | undefined;

  try {
    mongo = await MongoMemoryServer.create({
      instance: {
        ip: '127.0.0.1',
        port: options.port ?? preferredPort,
        portGeneration: true,
        storageEngine: 'wiredTiger',
        dbPath: dataPath,
        args: [
          '--replSet',
          REPLICA_SET_NAME,
          '--setParameter',
          `journalCommitInterval=${TEST_JOURNAL_COMMIT_INTERVAL_MS}`,
          ...(options.ttlMonitorSleepSecs === undefined
            ? []
            : [
                '--setParameter',
                'ttlMonitorEnabled=true',
                '--setParameter',
                `ttlMonitorSleepSecs=${options.ttlMonitorSleepSecs}`,
              ]),
        ],
      },
    });

    const baseUri = mongo.getUri();
    const baseAddress = new URL(baseUri);
    const setupUri = new URL(baseUri);
    setupUri.searchParams.set('directConnection', 'true');
    const setup = await mongoose
      .createConnection(setupUri.toString(), {
        serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      })
      .asPromise();
    const db = setup.db;
    if (!db) {
      await setup.close();
      throw new Error('replica set setup has no database handle');
    }
    try {
      await db.admin().command({
        replSetInitiate: {
          _id: REPLICA_SET_NAME,
          members: [{ _id: 0, host: baseAddress.host }],
        },
      });
      await waitForPrimary(db);
    } finally {
      await setup.close();
    }

    const readyUri = new URL(mongo.getUri());
    readyUri.searchParams.set('replicaSet', REPLICA_SET_NAME);
    await waitForCommittedTransaction(readyUri.toString());

    return {
      uri: readyUri.toString(),
      port: Number.parseInt(baseAddress.port, 10),
      dataPath,
      stop: async () => {
        try {
          await mongo?.stop();
        } finally {
          await rm(dataPath, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      await mongo?.stop();
    } finally {
      await rm(dataPath, { recursive: true, force: true });
    }
    throw error;
  }
}

function readSharedMongoUris(): string[] {
  const value = process.env[BACKEND_TEST_MONGO_URIS_ENV];
  if (!value) {
    throw new Error('The shared Jest MongoDB instances are not running');
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('The shared Jest MongoDB instance list is invalid');
  }

  const values: unknown[] = parsed;
  const uris: string[] = [];
  for (const uri of values) {
    if (typeof uri !== 'string' || uri.length === 0) {
      throw new Error('The shared Jest MongoDB instance list is invalid');
    }
    uris.push(uri);
  }
  return uris;
}

function readWorkerId(): number {
  const value = process.env.JEST_WORKER_ID;
  if (value === undefined) return 1;

  const workerId = Number.parseInt(value, 10);
  if (!Number.isInteger(workerId) || workerId < 1) {
    throw new Error(`Invalid Jest worker id: ${value}`);
  }
  return workerId;
}

function scopedDatabaseName(
  suiteHash: string,
  fixtureId: number,
  requestedName: string,
): string {
  const nameHash = createHash('sha256')
    .update(requestedName)
    .digest('hex')
    .slice(0, DATABASE_HASH_LENGTH);
  const label = requestedName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const prefix = `j_${suiteHash}_${fixtureId.toString(36)}_${nameHash}_`;
  const labelLength = Math.min(
    DATABASE_LABEL_LENGTH,
    DATABASE_NAME_LIMIT - prefix.length,
  );
  return `${prefix}${label.slice(0, labelLength)}`;
}

async function waitForPrimary(db: Db): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const hello = await db.admin().command({ hello: 1 });
    if (hello.isWritablePrimary === true || hello.ismaster === true) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error('replica set did not become primary');
}

async function waitForCommittedTransaction(uri: string): Promise<void> {
  const connection = await mongoose
    .createConnection(uri, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    })
    .asPromise();
  const deadline = Date.now() + 20000;
  let lastError: unknown;
  try {
    while (Date.now() < deadline) {
      const session = await connection.startSession();
      try {
        session.startTransaction({ writeConcern: { w: 'majority' } });
        await connection
          .collection('replset_probe')
          .insertOne({ at: new Date() }, { session });
        await session.commitTransaction();
        return;
      } catch (error) {
        lastError = error;
        if (session.inTransaction()) {
          try {
            await session.abortTransaction();
          } catch (abortError) {
            // Abort can fail after the server has already ended the attempt.
            if (!(error instanceof Error) && abortError instanceof Error) {
              lastError = abortError;
            }
          }
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        });
      } finally {
        await session.endSession();
      }
    }
    const detail =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`replica set cannot commit a transaction: ${detail}`);
  } finally {
    await connection.close();
  }
}
