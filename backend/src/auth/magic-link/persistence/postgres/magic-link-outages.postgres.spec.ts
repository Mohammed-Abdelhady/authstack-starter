import { Kysely } from 'kysely';
import { Pool } from 'pg';
import {
  openPostgresDatabase,
  PostgresTables,
} from '../../../../common/persistence/postgres/postgres-database';
import {
  PostgresMagicLinkAccounts,
  PostgresMagicLinkStore,
} from './postgres-magic-link.store';
import { raisedBy } from '../../../../../test/utils/auth/store-outage-cases';
import { closedPort } from '../../../../../test/postgres/closed-port';
import {
  MAGIC_LINK_OUTAGES,
  magicLinkStatements,
} from '../../contract/magic-link-outage-cases.harness-spec';

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

/** Store methods the outage table leaves out, each with its reason. */
const NOT_LISTED: Record<string, string> = {
  'account.markVerified':
    'takes an account this store read, and a database that is away reads none',
};

/** Every method a store class declares, as the outage table names them. */
function methodsOf(prefix: string, store: object): string[] {
  const declared: unknown = Object.getPrototypeOf(store);
  return Object.getOwnPropertyNames(declared)
    .filter((name) => name !== 'constructor')
    .map((name) => `${prefix}.${name}`);
}

describe('PostgreSQL magic link statements that commit by themselves', () => {
  let database: Kysely<PostgresTables>;

  beforeAll(async () => {
    const pool = new Pool({ host: '127.0.0.1', port: await closedPort() });
    pool.on('error', () => undefined);
    database = openPostgresDatabase(pool);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('lists every method of the link and account stores, or says why one is left out', () => {
    const links = new PostgresMagicLinkStore(database);
    const accounts = new PostgresMagicLinkAccounts(database);
    const listed = [
      ...Object.keys(magicLinkStatements(links, accounts)),
      ...Object.keys(NOT_LISTED),
    ];

    expect(listed.sort()).toEqual(
      [...methodsOf('link', links), ...methodsOf('account', accounts)].sort(),
    );
  });

  it('raises the shared outage from every link and account statement', async () => {
    const statements = magicLinkStatements(
      new PostgresMagicLinkStore(database),
      new PostgresMagicLinkAccounts(database),
    );

    expect(await raisedBy(statements)).toEqual(MAGIC_LINK_OUTAGES);
  });
});
