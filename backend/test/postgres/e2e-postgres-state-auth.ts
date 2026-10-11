import type { INestApplication } from '@nestjs/common';
import type { PostgresDatabase } from '../../src/common/persistence/postgres/postgres-connection';
import type { E2eAuthState } from '../utils/e2e-state-auth';
import { postgresAccountState } from './e2e-postgres-state-auth-accounts';
import { postgresAuthFaults } from './e2e-postgres-state-auth-faults';
import { postgresPendingCodeState } from './e2e-postgres-state-auth-pending';
import type { CommitFaultDialect } from './postgres-commit-faults';

/** What the sign-up, sign-in and account cases arrange and read, on PostgreSQL. */
export function postgresAuthState(
  app: INestApplication,
  database: PostgresDatabase,
  commitFaults: CommitFaultDialect,
): E2eAuthState {
  return {
    ...postgresAccountState(
      database,
      app, // feature:passkeys
    ),
    ...postgresPendingCodeState(database),
    ...postgresAuthFaults(app, commitFaults),
  };
}
