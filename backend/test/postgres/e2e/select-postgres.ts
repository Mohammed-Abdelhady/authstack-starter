import { useE2eStorage } from '../../utils/e2e-storage';
import { startPostgresE2eStorage } from './e2e-postgres-storage';
import { watchPostgresFixtureConnections } from './postgres-fixture-connections';

/**
 * Every fixture of the PostgreSQL run boots on a database of the shared
 * server, and a case that watches a fixture's connections watches that server.
 */
useE2eStorage({
  start: startPostgresE2eStorage,
  watchConnections: watchPostgresFixtureConnections,
});
