import {
  ActivatedAccount,
  ActivationSignIn,
  ActivationSignInOutcome,
} from '../../src/auth/pending-codes/activation-accounts';
import { activatedSignInAccountOf } from '../../src/auth/persistence/postgres/postgres-activation-accounts';
import type { Kysely } from 'kysely';
import { PostgresEnrolmentStore } from '../../src/session/persistence/postgres/postgres-enrolment.store';
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
    new PostgresEnrolmentStore(),
  );
}

/**
 * Answers with the account the activation stored and issues nothing, the way
 * the stand-in on the other database does, so both run the same cases.
 */
export class SummarySignIn extends ActivationSignIn {
  recordCreationRefusal(_clientId: string): Promise<void> {
    return Promise.resolve();
  }

  complete(account: ActivatedAccount): Promise<ActivationSignInOutcome> {
    const stored = activatedSignInAccountOf(account);
    return Promise.resolve({
      requiresTwoFactor: false,
      user: {
        id: stored.id,
        email: stored.email,
        name: stored.name,
        role: stored.role,
        authProvider: stored.authProvider,
        isVerified: stored.isVerified,
        permissions: [],
      },
    });
  }
}
