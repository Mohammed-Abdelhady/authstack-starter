import { Kysely } from 'kysely';
import { Pool } from 'pg';
import { PostgresBrowserProofStore } from './postgres-browser-proof.store';
import {
  openPostgresDatabase,
  PostgresTables,
} from '../../../common/persistence/postgres/postgres-database';
import { PostgresSecurityEventStore } from './postgres-security-event.store';
import { closedPort } from '../../../../test/postgres/closed-port';
import { raisedBy } from '../../../../test/utils/auth/store-outage-cases';
import {
  PROOFS_EVENTS_OUTAGES,
  proofsEventsStatements,
} from '../../../../test/utils/session/proofs-events-contract/proofs-events-outage-cases';

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

describe('PostgreSQL proof and event statements that commit by themselves', () => {
  let database: Kysely<PostgresTables>;

  beforeAll(async () => {
    const pool = new Pool({ host: '127.0.0.1', port: await closedPort() });
    pool.on('error', () => undefined);
    database = openPostgresDatabase(pool);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('raises the shared outage from every proof and event statement', async () => {
    const statements = proofsEventsStatements(
      new PostgresBrowserProofStore(database),
      new PostgresSecurityEventStore(database),
    );

    expect(await raisedBy(statements)).toEqual(PROOFS_EVENTS_OUTAGES);
  });
});
