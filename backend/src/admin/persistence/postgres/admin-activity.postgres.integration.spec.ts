import { sql } from 'kysely';
import {
  UnitOfWorkRunner,
  type UnitOfWork,
} from '../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { RaceGate } from '../../../../test/utils/race-gate';
import { servicesOn } from '../../../../test/utils/user/accounts-contract/accounts-contract-support';
import { seedAccountsFixture } from '../../../../test/utils/user/accounts-contract/accounts-contract-fixture';
import {
  bootPostgresAccountsHarness,
  type PostgresAccountsHarness,
} from '../../../../test/postgres/postgres-accounts-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';

describe('retained activity after physical cleanup', () => {
  let h: PostgresAccountsHarness;
  beforeAll(async () => {
    h = await bootPostgresAccountsHarness();
  }, POSTGRES_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await h?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await h.reset();
  }, POSTGRES_RESET_TIMEOUT_MS);

  it('refuses a real blocked activity read and rolls back the preceding account edit', async () => {
    const fixture = await seedAccountsFixture(h);
    const before = await h.admin.findAccount(fixture.userId);
    const gate = new RaceGate();
    const held = h.database.transaction().execute(async (work) => {
      await sql`LOCK TABLE sessions IN ACCESS EXCLUSIVE MODE`.execute(work);
      await gate.hold();
    });
    const real = h.runner(() => Promise.resolve());
    const bounded = new (class extends UnitOfWorkRunner {
      run<T>(work: (unit: UnitOfWork) => Promise<T>): Promise<T> {
        return real.run(async (unit) => {
          await sql`SET LOCAL lock_timeout = '1ms'`.execute(
            postgresTransactionOf(unit),
          );
          return work(unit);
        });
      }
    })();
    await gate.reached();
    try {
      await expect(
        bounded.run((work) => h.admin.lastActiveFor([fixture.userId], work)),
      ).rejects.toMatchObject({ kind: 'retryable_abort' });
      const services = servicesOn({ ...h, runner: () => bounded });
      await expect(
        services.adminUsers.updateUser(
          fixture.userId,
          { name: 'Must roll back' },
          fixture.managerId,
          'manager',
        ),
      ).rejects.toMatchObject({ status: 503, code: 'AUTHORITY_UNAVAILABLE' });
    } finally {
      gate.release();
      await held;
    }
    expect(await h.admin.findAccount(fixture.userId)).toEqual(before);
  });
});
