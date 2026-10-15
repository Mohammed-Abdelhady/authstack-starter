import { EnrolmentStore } from '../../enrolment/enrolment.store';
import { PostgresEnrolmentStore } from './postgres-enrolment.store';
import { Provider } from '@nestjs/common';
import { Pool } from 'pg';
import {
  POSTGRES_DATABASE,
  POSTGRES_POOL,
  PostgresDatabase,
} from '../../../common/persistence/postgres/postgres-connection';
import { onDatabase } from '../../../common/persistence/postgres/postgres-providers';
import { PostgresRetentionJob } from '../../../common/persistence/postgres/postgres-retention';
import { PostgresStorageStartup } from '../../../common/persistence/postgres/postgres-storage-startup';
import { PostgresUnitOfWorkRunner } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { StorageStartup } from '../../../common/persistence/storage-startup';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { Clock } from '../../../common/services/clock';
import { ApplicationAccessStore } from '../../applications/application-access.store';
import { ApplicationRegistry } from '../../applications/application-registry';
import { ApplicationRegistryStore } from '../../applications/application-registry.store';
import { AuthorityApplications } from '../../authority/authority-applications';
import { SessionAuthorityStore } from '../../authority/session-authority.store';
import { SecurityEventRecorder } from '../../events/security-event-recorder';
import { SecurityEventStore } from '../../events/security-event.store';
import { BrowserIssuanceStore } from '../../issuance/browser-issuance.store';
import { IssuanceApplications } from '../../issuance/issuance-applications';
import { NativeAccessStore } from '../../native/credentials/native-access.store';
import { NativeCredentialStore } from '../../native/credentials/native-credential.store';
import { NativeSecurityEvents } from '../../native/credentials/native-security-events';
import { PostgresNativeAccessStore } from '../../native/persistence/postgres/postgres-native-access.store';
import { PostgresNativeCredentialStore } from '../../native/persistence/postgres/postgres-native-credential.store';
import { PostgresNativeSecurityEvents } from '../../native/persistence/postgres/postgres-native-security-events';
import { BrowserProofStore } from '../../proofs/browser-proof.store';
import { SessionRevocationStore } from '../../revocation/session-revocation.store';
import { PostgresApplicationAccessStore } from './postgres-application-access.store';
import { PostgresApplicationRegistryStore } from './postgres-application-registry.store';
import { PostgresAuthorityApplications } from './postgres-authority-applications';
import { PostgresBrowserIssuanceStore } from './postgres-browser-issuance.store';
import { PostgresBrowserProofStore } from './postgres-browser-proof.store';
import { PostgresIssuanceApplications } from './postgres-issuance-applications';
import { PostgresSecurityEventStore } from './postgres-security-event.store';
import { PostgresSessionAuthorityStore } from './postgres-session-authority.store';
import { PostgresSessionRevocationStore } from './postgres-session-revocation.store';

/** The session stores on PostgreSQL, each over the shared pool. */
export const POSTGRES_SESSION_PROVIDERS: Provider[] = [
  { provide: EnrolmentStore, useClass: PostgresEnrolmentStore },
  onDatabase(
    ApplicationRegistryStore,
    (database) => new PostgresApplicationRegistryStore(database),
  ),
  {
    provide: ApplicationAccessStore,
    useFactory: (
      database: PostgresDatabase,
      clock: Clock,
      events: SecurityEventStore,
    ) => new PostgresApplicationAccessStore(database, clock, events),
    inject: [POSTGRES_DATABASE, Clock, SecurityEventStore],
  },
  onDatabase(
    BrowserProofStore,
    (database) => new PostgresBrowserProofStore(database),
  ),
  onDatabase(
    SecurityEventStore,
    (database) => new PostgresSecurityEventStore(database),
  ),
  onDatabase(
    UnitOfWorkRunner,
    (database) => new PostgresUnitOfWorkRunner(database),
  ),
  {
    provide: StorageStartup,
    useFactory: (pool: Pool) => new PostgresStorageStartup(pool),
    inject: [POSTGRES_POOL],
  },
  {
    provide: BrowserIssuanceStore,
    useFactory: (
      authEpoch: AuthEpochService,
      clock: Clock,
      events: SecurityEventStore,
    ) =>
      new PostgresBrowserIssuanceStore(authEpoch.environment(), clock, events),
    inject: [AuthEpochService, Clock, SecurityEventStore],
  },
  {
    provide: IssuanceApplications,
    useFactory: (registry: ApplicationRegistry) =>
      new PostgresIssuanceApplications(registry),
    inject: [ApplicationRegistry],
  },
  onDatabase(
    SessionAuthorityStore,
    (database) => new PostgresSessionAuthorityStore(database),
  ),
  {
    provide: AuthorityApplications,
    useFactory: (registry: ApplicationRegistry) =>
      new PostgresAuthorityApplications(registry),
    inject: [ApplicationRegistry],
  },
  {
    provide: SessionRevocationStore,
    useFactory: (clock: Clock, events: SecurityEventStore) =>
      new PostgresSessionRevocationStore(clock, events),
    inject: [Clock, SecurityEventStore],
  },
  { provide: NativeCredentialStore, useClass: PostgresNativeCredentialStore },
  onDatabase(
    NativeAccessStore,
    (database) => new PostgresNativeAccessStore(database),
  ),
  {
    provide: NativeSecurityEvents,
    useFactory: (recorder: SecurityEventRecorder) =>
      new PostgresNativeSecurityEvents(recorder),
    inject: [SecurityEventRecorder],
  },
  // PostgreSQL has no index that expires rows. A job removes them.
  {
    provide: PostgresRetentionJob,
    useFactory: (database: PostgresDatabase, clock: Clock) =>
      new PostgresRetentionJob(database, clock),
    inject: [POSTGRES_DATABASE, Clock],
  },
];
