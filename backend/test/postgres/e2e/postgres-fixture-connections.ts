import { Client } from 'pg';
import type { FixtureConnectionWatch } from '../../utils/e2e-storage';
import { sharedPostgresServer } from './postgres-e2e-server';

const FIXTURE_DATABASE_PATTERN = String.raw`auth\_e2e\_%`;

async function fixtureDatabases(client: Client): Promise<string[]> {
  const found = await client.query<{ datname: string }>(
    'SELECT datname FROM pg_database WHERE datname LIKE $1',
    [FIXTURE_DATABASE_PATTERN],
  );
  return found.rows.map((row) => row.datname);
}

let sessionsLeftOpen = 0;

/**
 * Called by a fixture that found sessions still connected to its database
 * when it came to drop it: connections a pool was never made to close.
 */
export function noteSessionsLeftOpen(count: number): void {
  sessionsLeftOpen += count;
}

/**
 * The probe is a session of the case's own on the shared server. A fixture's
 * connections live on a database of its own, and dropping that database is
 * what closes them. So a fixture database made after the watch began that
 * still exists counts, with or without a session on it at this instant: its
 * pools can open one at any time. So does every session a fixture had to end
 * by force to drop its database, because nothing had closed it.
 */
export async function watchPostgresFixtureConnections(): Promise<FixtureConnectionWatch> {
  const probe = new Client(sharedPostgresServer());
  probe.on('error', () => undefined);
  await probe.connect();
  const existingDatabases = new Set(await fixtureDatabases(probe));
  const leftOpenBefore = sessionsLeftOpen;
  return {
    probePreserved: async () => {
      const answer = await probe
        .query<{ alive: boolean }>('SELECT true AS alive')
        .catch(() => undefined);
      return answer?.rows[0]?.alive === true;
    },
    retryingConnections: async () =>
      (await fixtureDatabases(probe)).filter(
        (database) => !existingDatabases.has(database),
      ).length +
      (sessionsLeftOpen - leftOpenBefore),
    close: async () => {
      await probe.end().catch(() => undefined);
    },
  };
}
