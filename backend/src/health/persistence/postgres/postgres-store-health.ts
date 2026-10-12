import { Pool } from 'pg';
import {
  NODE_TIMERS,
  ScheduleTimers,
  withinDelay,
} from '../../../common/persistence/postgres/owned-schedule';
import {
  STORE_HEALTH,
  StoreHealth,
  StoreHealthState,
} from '../../store-health';

/**
 * A server in recovery is a standby, and a session that may only read cannot
 * take a write either. Both are told apart from a server that does not answer.
 */
const WRITABLE = `
  SELECT NOT pg_is_in_recovery()
     AND current_setting('transaction_read_only') = 'off' AS writable`;

/**
 * How long one look may take. A server that has not answered this one-row
 * statement in three seconds is not serving requests either, and three is
 * under the five seconds between looks, so a look that hangs never delays the
 * next one.
 */
export const STORE_HEALTH_LOOK_MS = 3_000;

const NO_ANSWER = Symbol('no answer in time');

/**
 * The pool keeps no connection state of its own, so this adapter asks the
 * server when told to and remembers the answer. Until it has asked once it
 * knows nothing, and says the store is unreachable. A look that is not
 * answered within `STORE_HEALTH_LOOK_MS` counts as unreachable, and an answer
 * that arrives after a later look started is dropped.
 */
export class PostgresStoreHealth extends StoreHealth {
  private state: StoreHealthState = STORE_HEALTH.UNREACHABLE;
  private looks = 0;

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly timers: ScheduleTimers = NODE_TIMERS,
  ) {
    super();
  }

  current(): StoreHealthState {
    return this.state;
  }

  /** Asks the server once and keeps what it said. Never throws, never hangs. */
  async observe(): Promise<StoreHealthState> {
    this.looks += 1;
    const look = this.looks;
    const seen = await this.look();
    if (look === this.looks) {
      this.state = seen;
    }
    return this.state;
  }

  private async look(): Promise<StoreHealthState> {
    try {
      const answer = await withinDelay<
        { rows: Array<{ writable: boolean }> } | typeof NO_ANSWER
      >(
        this.pool.query<{ writable: boolean }>(WRITABLE),
        STORE_HEALTH_LOOK_MS,
        () => NO_ANSWER,
        this.timers,
      );
      if (answer === NO_ANSWER) {
        return STORE_HEALTH.UNREACHABLE;
      }
      return answer.rows[0]?.writable === true
        ? STORE_HEALTH.READY
        : STORE_HEALTH.NOT_WRITABLE;
    } catch {
      return STORE_HEALTH.UNREACHABLE;
    }
  }
}
