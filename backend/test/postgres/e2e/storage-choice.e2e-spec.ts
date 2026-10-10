import { getConnectionToken } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { Pool } from 'pg';
import request from 'supertest';
import { POSTGRES_POOL } from '../../../src/common/persistence/postgres/postgres-connection';
import { PostgresRetentionJob } from '../../../src/common/persistence/postgres/postgres-retention';
import { PostgresStoreHealthWatch } from '../../../src/health/persistence/postgres/postgres-store-health-watch';
import { bootE2eApp, E2eApp } from '../../utils/e2e-app';

/** What a booted server holds, by the database its setting names. */
const EXPECTED = {
  mongodb: {
    health: 'healthy',
    mongoConnection: true,
    postgresPool: false,
    retentionJob: false,
    healthWatch: false,
    connectionsOpenedOnTheOther: 0,
  },
  postgres: {
    health: 'healthy',
    mongoConnection: false,
    postgresPool: true,
    retentionJob: true,
    healthWatch: true,
    connectionsOpenedOnTheOther: 0,
  },
} as const;

describe('the database the server runs on (e2e)', () => {
  const run = process.env.DATABASE_TYPE === 'postgres' ? 'postgres' : 'mongodb';
  let e2e: E2eApp;
  let poolConnects: jest.SpyInstance;
  let mongoOpens: jest.SpyInstance;

  beforeAll(async () => {
    poolConnects = jest.spyOn(Pool.prototype, 'connect');
    mongoOpens = jest.spyOn(mongoose.Connection.prototype, 'openUri');
    e2e = await bootE2eApp();
  });

  afterAll(async () => {
    await e2e?.close();
    jest.restoreAllMocks();
  });

  function holds(token: Parameters<E2eApp['app']['get']>[0]): boolean {
    try {
      e2e.app.get(token, { strict: false });
      return true;
    } catch {
      return false;
    }
  }

  it('opens the chosen database and nothing of the other one', async () => {
    const health = await request(e2e.httpServer).get('/health').expect(200);
    const opened = run === 'mongodb' ? poolConnects : mongoOpens;

    expect({
      health: (health.body as { status: string }).status,
      mongoConnection: holds(getConnectionToken()),
      postgresPool: holds(POSTGRES_POOL),
      retentionJob: holds(PostgresRetentionJob),
      healthWatch: holds(PostgresStoreHealthWatch),
      connectionsOpenedOnTheOther: opened.mock.calls.length,
    }).toEqual(EXPECTED[run]);
  });
});
