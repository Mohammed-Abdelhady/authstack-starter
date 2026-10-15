import { Provider } from '@nestjs/common';
import { onDatabase } from '../../../common/persistence/postgres/postgres-providers';
import { PostgresUnitOfWorkRunner } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { SecurityEventStore } from '../../../session/events/security-event.store';
import { PostgresSecurityEventStore } from '../../../session/persistence/postgres/postgres-security-event.store';
import { PostgresSessionRevocationStore } from '../../../session/persistence/postgres/postgres-session-revocation.store';
import { SessionRevocationStore } from '../../../session/revocation/session-revocation.store';
import { PostgresAudienceMappingStore } from '../../../user/persistence/postgres/postgres-audience-mapping.store';
import { AudienceMappingStore } from '../../../user/stores/audience-mapping.store';

export const POSTGRES_AUDIENCE_COMMAND_PROVIDERS: Provider[] = [
  onDatabase(
    UnitOfWorkRunner,
    (database) => new PostgresUnitOfWorkRunner(database),
  ),
  onDatabase(
    SecurityEventStore,
    (database) => new PostgresSecurityEventStore(database),
  ),
  {
    provide: SessionRevocationStore,
    useFactory: (clock: Clock, events: SecurityEventStore) =>
      new PostgresSessionRevocationStore(clock, events),
    inject: [Clock, SecurityEventStore],
  },
  { provide: AudienceMappingStore, useClass: PostgresAudienceMappingStore },
];
