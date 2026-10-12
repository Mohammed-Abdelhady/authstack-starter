import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { NODE_TIMERS } from '../../../common/persistence/postgres/owned-schedule';
import {
  openPostgresPool,
  postgresPoolConfig,
} from '../../../common/persistence/postgres/postgres-connection';
import { StoreHealth } from '../../store-health';
import { PostgresStoreHealth } from './postgres-store-health';
import { PostgresStoreHealthWatch } from './postgres-store-health-watch';

/** The one connection the health look has to itself. */
export const POSTGRES_HEALTH_POOL = Symbol('POSTGRES_HEALTH_POOL');

export const POSTGRES_HEALTH_PROVIDERS: Provider[] = [
  {
    // Not the application pool: with every application connection busy, the
    // database is still up, and the look must be able to say so.
    provide: POSTGRES_HEALTH_POOL,
    useFactory: (config: ConfigService): Pool =>
      openPostgresPool({ ...postgresPoolConfig(config), max: 1 }),
    inject: [ConfigService],
  },
  {
    provide: PostgresStoreHealth,
    useFactory: (pool: Pool) => new PostgresStoreHealth(pool),
    inject: [POSTGRES_HEALTH_POOL],
  },
  { provide: StoreHealth, useExisting: PostgresStoreHealth },
  {
    provide: PostgresStoreHealthWatch,
    useFactory: (health: PostgresStoreHealth, pool: Pool) =>
      new PostgresStoreHealthWatch(health, NODE_TIMERS, pool),
    inject: [PostgresStoreHealth, POSTGRES_HEALTH_POOL],
  },
];
