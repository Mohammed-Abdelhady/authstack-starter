import { Provider } from '@nestjs/common';
import {
  onDatabase,
  onDatabaseWithClock,
} from '../../../common/persistence/postgres/postgres-providers';
import { Clock } from '../../../common/services/clock';
import { SecurityEventStore } from '../../../session/events/security-event.store';
import { RoleCatalogStore } from '../../stores/role-catalog.store';
import { RoleChangeStore } from '../../stores/role-change.store';
import { RoleSweepStore } from '../../stores/role-sweep.store';
import { PostgresRoleCatalogStore } from './postgres-role-catalog.store';
import { PostgresRoleChangeStore } from './postgres-role-change.store';
import { PostgresRoleSweepStore } from './postgres-role-sweep.store';

export const POSTGRES_ROLE_PROVIDERS: Provider[] = [
  onDatabase(
    RoleCatalogStore,
    (database) => new PostgresRoleCatalogStore(database),
  ),
  {
    provide: RoleChangeStore,
    useFactory: (clock: Clock, events: SecurityEventStore) =>
      new PostgresRoleChangeStore(clock, events),
    inject: [Clock, SecurityEventStore],
  },
  onDatabaseWithClock(
    RoleSweepStore,
    (database, clock) => new PostgresRoleSweepStore(database, clock),
  ),
];
