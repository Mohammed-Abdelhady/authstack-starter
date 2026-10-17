import { ConfigService } from '@nestjs/config';
import { HealthService } from '../../../src/health/health.service';
import { StoreHealth } from '../../../src/health/store-health';

export interface StoreHealthHarness {
  readonly health: StoreHealth;
  /** Lets the adapter take a fresh look at the store, where it has to be asked. */
  observe(): Promise<void>;
  /** Makes the store unreachable for this adapter, for the rest of the suite. */
  cutOff(): Promise<void>;
  /**
   * An adapter on a connection that may only read, freshly observed. Null where
   * the adapter does not tell such a connection from a ready one.
   */
  readOnly(): Promise<StoreHealth | null>;
  close(): Promise<void>;
}

/**
 * The store health contract. Every database runs these same cases through its
 * own harness. The cases run in order: the last one cuts the store off.
 */
export function describeStoreHealthContract(
  database: string,
  boot: () => Promise<StoreHealthHarness>,
  budgets: { bootMs: number; teardownMs: number },
): void {
  describe(`store health contract on ${database}`, () => {
    let harness: StoreHealthHarness | undefined;
    const current = (): StoreHealthHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };
    const serviceOn = (store: StoreHealth): HealthService =>
      new HealthService(store, new ConfigService({ auth: { epoch: 7 } }));

    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);

    afterAll(async () => {
      await harness?.close();
    }, budgets.teardownMs);

    it('answers ready for a reachable primary, and the service says healthy', async () => {
      await current().observe();

      const answer = serviceOn(current().health).getHealth();

      expect({
        store: current().health.current(),
        database: serviceOn(current().health).checkDatabaseHealth(),
        status: answer.status,
        authEpoch: answer.authEpoch,
        commit: answer.commit,
        keys: Object.keys(answer).sort(),
      }).toEqual({
        store: 'ready',
        database: { status: 'connected' },
        status: 'healthy',
        authEpoch: 7,
        commit: null,
        keys: [
          'authEpoch',
          'authSchemaVersion',
          'commit',
          'status',
          'timestamp',
        ],
      });
    });

    it('answers not writable where writes would be refused, and the service says unhealthy', async () => {
      const readOnly = await current().readOnly();
      if (readOnly === null) {
        // This adapter takes a connected driver as ready. The page of known
        // differences says so.
        expect(current().health.current()).toBe('ready');
        return;
      }

      expect({
        store: readOnly.current(),
        database: serviceOn(readOnly).checkDatabaseHealth(),
        status: serviceOn(readOnly).getHealth().status,
      }).toEqual({
        store: 'not_writable',
        database: { status: 'disconnected' },
        status: 'unhealthy',
      });
    });

    it('answers unreachable once the store is cut off, and the service says unhealthy', async () => {
      await current().cutOff();
      await current().observe();

      expect({
        store: current().health.current(),
        database: serviceOn(current().health).checkDatabaseHealth(),
        status: serviceOn(current().health).getHealth().status,
      }).toEqual({
        store: 'unreachable',
        database: { status: 'disconnected' },
        status: 'unhealthy',
      });
    });
  });
}
