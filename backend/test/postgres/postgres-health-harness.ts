import { Pool } from 'pg';
import { StoreHealthHarness } from '../utils/health/store-health-contract';
import { PostgresStoreHealth } from '../../src/health/persistence/postgres/postgres-store-health';
import { closedPort } from './closed-port';
import { startPostgresTestServer } from './server/postgres-test-server';

/** Pools of this harness never wait: a server that does not answer is refused. */
const CONNECT_BUDGET_MS = 2_000;

export interface PostgresHealthHarness extends StoreHealthHarness {
  /** The adapter before it has looked at the server once. */
  readonly unobserved: PostgresStoreHealth;
}

export async function bootPostgresHealthHarness(): Promise<PostgresHealthHarness> {
  const server = await startPostgresTestServer();
  const pools: Pool[] = [];
  const poolOn = (overrides: { port?: number; options?: string }): Pool => {
    const pool = new Pool({
      ...server.connection,
      ...overrides,
      connectionTimeoutMillis: CONNECT_BUDGET_MS,
    });
    // A connection the server drops must not take the test process down.
    pool.on('error', () => undefined);
    pools.push(pool);
    return pool;
  };
  let observed = new PostgresStoreHealth(poolOn({}));
  const health = {
    current: () => observed.current(),
  };

  return {
    health,
    unobserved: new PostgresStoreHealth(poolOn({})),
    observe: async () => {
      await observed.observe();
    },
    cutOff: async () => {
      observed = new PostgresStoreHealth(poolOn({ port: await closedPort() }));
    },
    readOnly: async () => {
      const readOnly = new PostgresStoreHealth(
        poolOn({ options: '-c default_transaction_read_only=on' }),
      );
      await readOnly.observe();
      return readOnly;
    },
    close: async () => {
      await Promise.all(pools.map((pool) => pool.end()));
      await server.stop();
    },
  };
}
