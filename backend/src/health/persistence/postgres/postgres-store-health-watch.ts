import { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  NODE_TIMERS,
  OwnedSchedule,
  ScheduleTimers,
} from '../../../common/persistence/postgres/owned-schedule';
import {
  EndablePool,
  endPoolWithin,
} from '../../../common/persistence/postgres/postgres-connection';
import { PostgresStoreHealth } from './postgres-store-health';

/** How often the server is asked whether it answers and takes writes. */
export const STORE_HEALTH_INTERVAL_MS = 5_000;

/**
 * Owns the one schedule that keeps the health adapter's answer fresh. It asks
 * once before the application serves, so the first health request already has
 * an answer, then on an interval. It stops when the module is destroyed and
 * ends the look's own connection, each within a stated bound.
 */
export class PostgresStoreHealthWatch
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly schedule: OwnedSchedule;

  constructor(
    health: PostgresStoreHealth,
    private readonly timers: ScheduleTimers = NODE_TIMERS,
    /** The connection the look has to itself, ended with this watch. */
    private readonly ownPool?: EndablePool,
  ) {
    this.schedule = new OwnedSchedule(
      'PostgresStoreHealth',
      STORE_HEALTH_INTERVAL_MS,
      async () => {
        await health.observe();
      },
      timers,
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.schedule.runOnce();
    this.schedule.start();
  }

  /** One look at the server now, or the look already going. */
  runOnce(): Promise<void> {
    return this.schedule.runOnce();
  }

  async onModuleDestroy(): Promise<void> {
    await this.schedule.stop();
    if (this.ownPool) {
      await endPoolWithin(this.ownPool, this.timers);
    }
  }
}
