import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import { Pool, PoolConfig } from 'pg';
import {
  POSTGRES_POOL_MAX_DEFAULT,
  POSTGRES_URL_REQUIRED,
} from '../../../config/env.storage.schema';
import { NODE_TIMERS, ScheduleTimers, withinDelay } from './owned-schedule';
import { openPostgresDatabase, PostgresTables } from './postgres-database';

/** The pool every PostgreSQL adapter of the application shares. */
export const POSTGRES_POOL = Symbol('POSTGRES_POOL');
/** The query builder on that pool. */
export const POSTGRES_DATABASE = Symbol('POSTGRES_DATABASE');

export type PostgresDatabase = Kysely<PostgresTables>;

/** How long a request waits for a free connection before it is refused. */
const CONNECTION_WAIT_MS = 10_000;
/** How long an unused connection is kept. */
const IDLE_CONNECTION_MS = 30_000;
const APPLICATION_NAME = 'auth-server';

/**
 * The server cancels a statement that runs this long. Every statement of the
 * application is a keyed read or write of a few rows, or one retention batch,
 * and takes milliseconds: fifteen seconds only ever ends a statement that is
 * stuck, and frees its connection and its locks.
 */
export const STATEMENT_TIMEOUT_MS = 15_000;
/**
 * The driver gives up on a statement the server never answered. It is above
 * the server's own bound, so a reachable server always answers first, and this
 * one only fires for a host that went silent.
 */
export const QUERY_TIMEOUT_MS = 20_000;
/**
 * An idle connection is probed after this long, so a host that dropped off the
 * network is noticed by the operating system instead of at the next statement.
 */
export const KEEP_ALIVE_DELAY_MS = 10_000;
/**
 * How long shutdown waits for the pool to hand its connections back. A
 * statement on a silent host would otherwise hold the process open until the
 * driver's own bound.
 */
export const POOL_END_WAIT_MS = 5_000;

function addressOf(config: ConfigService): string {
  const connectionString = config.get<string>('POSTGRES_URL');
  if (!connectionString) {
    throw new Error(POSTGRES_URL_REQUIRED);
  }
  return connectionString;
}

/**
 * The pool settings for this installation. Start-up validation has already
 * refused a missing or malformed address, so its absence here is a wiring
 * fault and is said plainly.
 */
export function postgresPoolConfig(config: ConfigService): PoolConfig {
  return {
    connectionString: addressOf(config),
    max: config.get<number>('POSTGRES_POOL_MAX', POSTGRES_POOL_MAX_DEFAULT),
    connectionTimeoutMillis: CONNECTION_WAIT_MS,
    idleTimeoutMillis: IDLE_CONNECTION_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEP_ALIVE_DELAY_MS,
    application_name: APPLICATION_NAME,
  };
}

/**
 * The settings of the migration command: one connection and no statement
 * bound, because building an index on a large table takes as long as it takes.
 */
export function postgresMigrationPoolConfig(config: ConfigService): PoolConfig {
  return {
    connectionString: addressOf(config),
    max: 1,
    connectionTimeoutMillis: CONNECTION_WAIT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEP_ALIVE_DELAY_MS,
    application_name: `${APPLICATION_NAME}-migrate`,
  };
}

/**
 * Opens nothing by itself: the pool connects on its first statement. An idle
 * connection the server drops is logged and replaced, and never ends the
 * process.
 */
export function openPostgresPool(config: PoolConfig): Pool {
  const logger = new Logger('Postgres');
  const pool = new Pool(config);
  pool.on('error', (error: Error) => {
    logger.error(`PostgreSQL connection error: ${error.message}`, error.stack);
  });
  return pool;
}

export type EndablePool = Pick<Pool, 'end' | 'ended'>;

/**
 * Ends the pool and waits for it at most `POOL_END_WAIT_MS`. Answers whether
 * it ended in time. A failure to end is the same to a stopping server as not
 * ending in time, so neither is thrown.
 */
export async function endPoolWithin(
  pool: EndablePool,
  timers: ScheduleTimers = NODE_TIMERS,
): Promise<boolean> {
  if (pool.ended) return true;
  return withinDelay(
    pool.end().then(
      () => true,
      () => false,
    ),
    POOL_END_WAIT_MS,
    () => false,
    timers,
  );
}

/** Ends the pool when the application stops, after the schedules that use it. */
@Injectable()
class PostgresConnectionLifetime implements OnApplicationShutdown {
  private readonly logger = new Logger('Postgres');

  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    if (!(await endPoolWithin(this.pool))) {
      this.logger.warn(
        `The pool did not end within ${POOL_END_WAIT_MS} ms. Stopping without it.`,
      );
    }
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: POSTGRES_POOL,
      useFactory: (config: ConfigService): Pool =>
        openPostgresPool(postgresPoolConfig(config)),
      inject: [ConfigService],
    },
    {
      provide: POSTGRES_DATABASE,
      useFactory: (pool: Pool): PostgresDatabase => openPostgresDatabase(pool),
      inject: [POSTGRES_POOL],
    },
    PostgresConnectionLifetime,
  ],
  exports: [POSTGRES_POOL, POSTGRES_DATABASE],
})
export class PostgresConnectionModule {}
