import { Client } from 'pg';
import type { PostgresTestServer } from '../server/postgres-test-server';

/** Where the run's one server is announced to every suite of the run. */
export const BACKEND_TEST_POSTGRES_ENV = 'BACKEND_TEST_POSTGRES_SERVER';

/** A migrated database every fixture's own database is copied from. */
export const E2E_TEMPLATE_DATABASE = 'auth_e2e_template';

export type PostgresServerAddress = PostgresTestServer['connection'];

function textOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`The shared PostgreSQL server announced no ${field}`);
  }
  return value;
}

/** The server the run's global setup started. */
export function sharedPostgresServer(): PostgresServerAddress {
  const announced = process.env[BACKEND_TEST_POSTGRES_ENV];
  if (!announced) {
    throw new Error('The shared Jest PostgreSQL server is not running');
  }
  const parsed: unknown = JSON.parse(announced);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The shared PostgreSQL server announced nothing usable');
  }
  const port: unknown = Reflect.get(parsed, 'port');
  if (typeof port !== 'number') {
    throw new Error('The shared PostgreSQL server announced no port');
  }
  return {
    host: textOf(Reflect.get(parsed, 'host'), 'host'),
    port,
    user: textOf(Reflect.get(parsed, 'user'), 'user'),
    password: textOf(Reflect.get(parsed, 'password'), 'password'),
    database: textOf(Reflect.get(parsed, 'database'), 'database'),
  };
}

/** The address as the connection setting an installation would be given. */
export function connectionUrl(
  server: PostgresServerAddress,
  database: string,
): string {
  const user = encodeURIComponent(server.user);
  const password = encodeURIComponent(server.password);
  return `postgres://${user}:${password}@${server.host}:${server.port}/${database}`;
}

/** Runs statements on the server's own database, on a connection of its own. */
export async function onServer<Result>(
  server: PostgresServerAddress,
  work: (client: Client) => Promise<Result>,
): Promise<Result> {
  const client = new Client(server);
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Quotes a name this harness made up itself. */
export function quotedName(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Not a database name this harness makes: ${name}`);
  }
  return `"${name}"`;
}
