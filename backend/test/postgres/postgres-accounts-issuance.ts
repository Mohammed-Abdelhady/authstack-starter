import type { Kysely } from 'kysely';
import type { PostgresTables } from '../../src/common/persistence/postgres/postgres-database';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import type { Clock } from '../../src/common/services/clock';
import { SecurityEventRecorder } from '../../src/session/events/security-event-recorder';
import type { SecurityEventStore } from '../../src/session/events/security-event.store';
import { PostgresBrowserIssuanceStore } from '../../src/session/persistence/postgres/postgres-browser-issuance.store';
import { SessionIssuanceService } from '../../src/session/services/session-issuance.service';
import type { postgresAccountsApplications } from './postgres-accounts-applications';

interface AccountsIssuanceInput {
  database: Kysely<PostgresTables>;
  clock: Clock;
  events: SecurityEventStore;
  creation: Pick<
    ReturnType<typeof postgresAccountsApplications>,
    'issuanceApplications' | 'authEpoch'
  >;
}

export function postgresAccountsIssuance({
  database,
  clock,
  events,
  creation,
}: AccountsIssuanceInput): SessionIssuanceService {
  return new SessionIssuanceService(
    new PostgresUnitOfWorkRunner(database),
    new PostgresBrowserIssuanceStore(
      creation.authEpoch.environment(),
      clock,
      events,
    ),
    creation.issuanceApplications,
    clock,
    creation.authEpoch,
    new SecurityEventRecorder(events, clock),
  );
}
