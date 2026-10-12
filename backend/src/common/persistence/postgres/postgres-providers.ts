import { Abstract, Provider } from '@nestjs/common';
import { Clock } from '../../services/clock';
import { POSTGRES_DATABASE, PostgresDatabase } from './postgres-connection';

/** Binds a port to an adapter built on the shared database. */
export function onDatabase<Port>(
  port: Abstract<Port>,
  make: (database: PostgresDatabase) => Port,
): Provider {
  return { provide: port, useFactory: make, inject: [POSTGRES_DATABASE] };
}

/** Binds a port to an adapter built on the shared database and the clock. */
export function onDatabaseWithClock<Port>(
  port: Abstract<Port>,
  make: (database: PostgresDatabase, clock: Clock) => Port,
): Provider {
  return {
    provide: port,
    useFactory: make,
    inject: [POSTGRES_DATABASE, Clock],
  };
}
