import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
import { Pool } from 'pg';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
  PostgresTestServer,
  startPostgresTestServer,
} from '../../../../test/postgres/server/postgres-test-server';
import {
  POSTGRES_HEALTH_POOL,
  POSTGRES_HEALTH_PROVIDERS,
} from '../../../health/persistence/postgres/postgres-health-persistence';
import { PostgresStoreHealthWatch } from '../../../health/persistence/postgres/postgres-store-health-watch';
import { StoreHealth } from '../../../health/store-health';
import { HandTimers } from './hand-timers.harness-spec';
import {
  endPoolWithin,
  openPostgresPool,
  POSTGRES_DATABASE,
  POSTGRES_POOL,
  PostgresConnectionModule,
  PostgresDatabase,
  postgresMigrationPoolConfig,
  postgresPoolConfig,
} from './postgres-connection';

describe('the PostgreSQL connection of the application', () => {
  let server: PostgresTestServer;

  beforeAll(async () => {
    server = await startPostgresTestServer();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await server?.stop();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  const urlOf = ({ connection }: PostgresTestServer): string =>
    `postgres://${connection.user}:${encodeURIComponent(connection.password)}@${connection.host}:${connection.port}/${connection.database}`;

  it('reads the pool settings from the validated environment', () => {
    const settings = postgresPoolConfig(
      new ConfigService({
        POSTGRES_URL: 'postgres://app:placeholder@db.internal:5432/auth',
        POSTGRES_POOL_MAX: 25,
      }),
    );
    const defaults = postgresPoolConfig(
      new ConfigService({ POSTGRES_URL: 'postgres://db.internal/auth' }),
    );

    expect({
      url: settings.connectionString,
      max: settings.max,
      defaultMax: defaults.max,
      waitsForever: settings.connectionTimeoutMillis === 0,
    }).toEqual({
      url: 'postgres://app:placeholder@db.internal:5432/auth',
      max: 25,
      defaultMax: 10,
      waitsForever: false,
    });
  });

  it('bounds every statement of the server, and leaves a migration unbounded on one connection', () => {
    const config = new ConfigService({
      POSTGRES_URL: 'postgres://db.internal/auth',
    });
    const server = postgresPoolConfig(config);
    const migration = postgresMigrationPoolConfig(config);

    expect({
      server: {
        statement: server.statement_timeout,
        query: server.query_timeout,
        keepAlive: server.keepAlive,
        keepAliveDelay: server.keepAliveInitialDelayMillis,
        connect: server.connectionTimeoutMillis,
      },
      migration: {
        statement: migration.statement_timeout,
        query: migration.query_timeout,
        max: migration.max,
        keepAlive: migration.keepAlive,
      },
    }).toEqual({
      server: {
        statement: 15000,
        query: 20000,
        keepAlive: true,
        keepAliveDelay: 10000,
        connect: 10000,
      },
      migration: {
        statement: undefined,
        query: undefined,
        max: 1,
        keepAlive: true,
      },
    });
  });

  it('has the server cancel a statement at the bound the pool was given', async () => {
    const pool = openPostgresPool({
      ...postgresPoolConfig(new ConfigService({ POSTGRES_URL: urlOf(server) })),
      max: 1,
    });

    const shown = await pool.query<{ statement_timeout: string }>(
      'SHOW statement_timeout',
    );
    await pool.end();

    expect(shown.rows[0].statement_timeout).toBe('15s');
  });

  it('stops waiting for a pool that does not end, after five seconds', async () => {
    const timers = new HandTimers();
    const hung = { ended: false, end: () => new Promise<void>(() => {}) };
    const done = { ended: true, end: jest.fn() };

    const waiting = endPoolWithin(hung, timers);
    timers.passDelays();

    expect({
      hung: await waiting,
      waited: timers.delays,
      alreadyEnded: await endPoolWithin(done, timers),
      endedAgain: done.end.mock.calls.length,
    }).toEqual({
      hung: false,
      waited: [5000],
      alreadyEnded: true,
      endedAgain: 0,
    });
  });

  it('answers health on a connection of its own while every application connection is busy', async () => {
    const url = urlOf(server);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => ({ POSTGRES_URL: url, POSTGRES_POOL_MAX: 1 })],
        }),
        PostgresConnectionModule,
      ],
      providers: POSTGRES_HEALTH_PROVIDERS,
    }).compile();
    const app = await moduleRef.init();
    const pool = app.get<Pool>(POSTGRES_POOL);
    const healthPool = app.get<Pool>(POSTGRES_HEALTH_POOL);
    const busy = await pool.connect();

    await app.get(PostgresStoreHealthWatch).runOnce();
    const whileBusy = {
      state: app.get(StoreHealth).current(),
      waitingForTheApplicationPool: pool.waitingCount,
    };
    busy.release();
    await app.close();

    expect({
      whileBusy,
      ownPool: healthPool !== pool,
      healthPoolEnded: healthPool.ended,
    }).toEqual({
      whileBusy: { state: 'ready', waitingForTheApplicationPool: 0 },
      ownPool: true,
      healthPoolEnded: true,
    });
  });

  it('refuses to build a pool without an address, and says which setting', () => {
    expect(() => postgresPoolConfig(new ConfigService({}))).toThrow(
      'POSTGRES_URL is required when DATABASE_TYPE is postgres',
    );
  });

  it('serves statements through the module, and ends the pool when the application stops', async () => {
    const url = urlOf(server);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => ({ POSTGRES_URL: url, POSTGRES_POOL_MAX: 2 })],
        }),
        PostgresConnectionModule,
      ],
    }).compile();
    const app = await moduleRef.init();
    const database = app.get<PostgresDatabase>(POSTGRES_DATABASE);
    const pool = app.get<Pool>(POSTGRES_POOL);

    const answered = await sql<{ one: number }>`SELECT 1 AS one`.execute(
      database,
    );
    const openWhileServing = pool.ended;
    await app.close();

    expect({
      one: answered.rows[0]?.one,
      openWhileServing,
      endedAfterStop: pool.ended,
    }).toEqual({ one: 1, openWhileServing: false, endedAfterStop: true });
  });
});
