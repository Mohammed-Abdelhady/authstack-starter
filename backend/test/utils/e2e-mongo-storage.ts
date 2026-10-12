import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { TestingModuleBuilder } from '@nestjs/testing';
import mongoose, { Connection, STATES } from 'mongoose';
import { mongoAuthState } from './e2e-mongo-state-auth';
import type {
  AttachedE2eStorage,
  E2eStorage,
  FixtureConnectionWatch,
} from './e2e-storage';
import { mongoRecordsState } from './e2e-mongo-state-records';
import {
  mongoAccountsState,
  mongoApplicationsState,
  mongoSessionsState,
} from './e2e-mongo-state-shared';
import { mongoNativeState } from './e2e-mongo-state-native';
import { startMemoryReplSet, startSharedMongoServer } from './memory-replset';

const DATABASE_NAME = 'auth_e2e';

/** A database of the shared MongoDB test server, and the fixture's own connection to it. */
export async function startMongoE2eStorage(): Promise<E2eStorage> {
  const mongo = await startMemoryReplSet();
  return createMongoE2eStorage(mongo.uri(DATABASE_NAME), mongo.stop);
}

/** The browser child owns its Mongo process; it does not run inside Jest. */
export async function startBrowserMongoE2eStorage(): Promise<E2eStorage> {
  const mongo = await startSharedMongoServer();
  const uri = new URL(mongo.uri);
  uri.pathname = `/${DATABASE_NAME}`;
  return createMongoE2eStorage(uri.toString(), mongo.stop);
}

function createMongoE2eStorage(
  uri: string,
  stopMongo: () => Promise<void>,
): E2eStorage {
  let fixtureConnection: Connection | undefined;

  return {
    environment: { MONGO_URI: uri },
    prepare: async (builder: TestingModuleBuilder): Promise<void> => {
      const { MONGOOSE_CONNECTION_OPTIONS } =
        await import('../../src/common/persistence/mongo/mongo-connection');
      // Own this connection so a failed compile cannot leave Nest retries running.
      fixtureConnection = await mongoose
        .createConnection(uri, { ...MONGOOSE_CONNECTION_OPTIONS })
        .asPromise();
      builder
        .overrideProvider(getConnectionToken())
        .useValue(fixtureConnection);
    },
    attach: async (app: INestApplication): Promise<AttachedE2eStorage> => {
      const connection = app.get<Connection>(getConnectionToken());
      const { ApplicationRegistryService: RegistryService } =
        await import('../../src/session/persistence/mongo/application-registry.service');
      const applications = app.get(RegistryService);
      const accounts = mongoAccountsState(app);
      return {
        state: {
          accounts,
          sessions: mongoSessionsState(app),
          applications: mongoApplicationsState(app),
          auth: mongoAuthState(app),
          native: mongoNativeState(app),
          records: mongoRecordsState(app),
        },
        empty: async () => {
          for (const collection of Object.values(connection.collections))
            await collection.deleteMany({});
        },
        seedApplications: async () => {
          await applications.seedFirstPartyApplications();
          await applications.ensureClientOriginAllowed();
        },
        seedAccounts: (seeded) => accounts.seedAccounts(seeded),
      };
    },
    stop: async (): Promise<void> => {
      let failure: unknown;
      let failed = false;
      if (fixtureConnection) {
        try {
          await fixtureConnection.destroy(true);
        } catch (error) {
          failure = error;
          failed = true;
        }
        fixtureConnection = undefined;
      }
      try {
        await stopMongo();
      } catch (error) {
        if (!failed) {
          failure = error;
          failed = true;
        }
      }
      if (failed) throw failure;
    },
  };
}

export function watchMongoFixtureConnections(): Promise<FixtureConnectionWatch> {
  const existingConnections = new Set(mongoose.connections);
  const probe = mongoose.createConnection();
  return Promise.resolve({
    probePreserved: () => Promise.resolve(mongoose.connections.includes(probe)),
    retryingConnections: () =>
      Promise.resolve(
        mongoose.connections.filter(
          (connection) =>
            !existingConnections.has(connection) &&
            connection !== probe &&
            (connection.readyState === STATES.connected ||
              connection.readyState === STATES.connecting),
        ).length,
      ),
    close: async () => {
      await probe.destroy(true).catch(() => undefined);
    },
  });
}
