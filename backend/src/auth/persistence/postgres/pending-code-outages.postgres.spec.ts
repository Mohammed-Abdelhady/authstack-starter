import { Kysely } from 'kysely';
import { Pool } from 'pg';
import {
  openPostgresDatabase,
  PostgresTables,
} from '../../../common/persistence/postgres/postgres-database';
import { PostgresMailCounterStore } from './postgres-mail-counter.store';
import { PostgresPasswordResetCodeStore } from './postgres-password-reset-code.store';
import { PostgresPendingRegistrationStore } from './postgres-pending-registration.store';
import {
  PENDING_CODE_OUTAGES,
  pendingCodeStatements,
  raisedBy,
} from '../../../../test/utils/auth/store-outage-cases';
import { closedPort } from '../../../../test/postgres/closed-port';

// feature:mongodb:start
jest.mock('mongoose', () => {
  throw new Error('mongoose was loaded on the PostgreSQL path');
});
jest.mock('mongodb', () => {
  throw new Error('mongodb was loaded on the PostgreSQL path');
});
jest.mock('@nestjs/mongoose', () => {
  throw new Error('@nestjs/mongoose was loaded on the PostgreSQL path');
});
// feature:mongodb:end

const A_UUID = '018f3c5e-7b1a-7c3e-9d2f-0a1b2c3d4e5f';

/** Store methods the outage table leaves out, each with its reason. */
const NOT_ONE_STATEMENT: Record<string, string> = {
  'registration.rotate': 'private, reached through the two rotations',
  'registration.claimCode': 'runs inside the unit of work of its caller',
  'reset.claimCodeIn': 'runs inside the unit of work of its caller',
};

/** Every method a store class declares, as the outage table names them. */
function methodsOf(prefix: string, store: object): string[] {
  const declared: unknown = Object.getPrototypeOf(store);
  return Object.getOwnPropertyNames(declared)
    .filter((name) => name !== 'constructor')
    .map((name) => `${prefix}.${name}`);
}

describe('PostgreSQL statements that commit by themselves', () => {
  let database: Kysely<PostgresTables>;

  beforeAll(async () => {
    const pool = new Pool({ host: '127.0.0.1', port: await closedPort() });
    pool.on('error', () => undefined);
    database = openPostgresDatabase(pool);
  });

  afterAll(async () => {
    await database.destroy();
  });

  function createStores() {
    return {
      mailCounters: new PostgresMailCounterStore(database),
      registrations: new PostgresPendingRegistrationStore(database),
      passwordResets: new PostgresPasswordResetCodeStore(database),
    };
  }

  it('lists every method of the three stores, or says why one is left out', () => {
    const stores = createStores();
    const listed = [
      ...Object.keys(pendingCodeStatements(stores, A_UUID)),
      ...Object.keys(NOT_ONE_STATEMENT),
    ];

    expect(listed.sort()).toEqual(
      [
        ...methodsOf('mail', stores.mailCounters),
        ...methodsOf('registration', stores.registrations),
        ...methodsOf('reset', stores.passwordResets),
      ].sort(),
    );
  });

  it('raises the shared outage from every pending-code statement', async () => {
    const stores = createStores();

    // No record without a purpose can exist, so this adapter answers that one
    // without a statement.
    expect(await raisedBy(pendingCodeStatements(stores, A_UUID))).toEqual({
      ...PENDING_CODE_OUTAGES,
      'registration.clearLegacyBlocker': 'resolved',
    });
  });
});
