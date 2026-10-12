import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import { Client } from 'pg';
import { openPostgresPool, postgresPoolConfig } from './postgres-connection';
import { openPostgresDatabase } from './postgres-database';
import {
  postgresTransactionOf,
  PostgresUnitOfWorkRunner,
} from './postgres-unit-of-work';

const SESSION_END_WAIT_MS = 30_000;

/**
 * Run as a process of its own, with nothing listening for uncaught failures,
 * so the exit code is what a server would do: a unit of work has a statement
 * in flight on the production pool when an administrator ends its session.
 * Says what became of the work and of the next statement, then ends.
 */
async function main(url: string): Promise<void> {
  const pool = openPostgresPool(
    postgresPoolConfig(new ConfigService({ POSTGRES_URL: url })),
  );
  const database = openPostgresDatabase(pool);
  const admin = new Client({ connectionString: url });
  await admin.connect();

  let announce: (pid: number) => void = () => undefined;
  const pidKnown = new Promise<number>((resolve) => {
    announce = resolve;
  });
  const work = new PostgresUnitOfWorkRunner(database)
    .run(async (unitOfWork) => {
      const transaction = postgresTransactionOf(unitOfWork);
      const asked = await sql<{ pid: number }>`
        SELECT pg_backend_pid() AS pid
      `.execute(transaction);
      announce(asked.rows[0].pid);
      await sql`SELECT pg_sleep(60)`.execute(transaction);
    })
    .then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.name : 'no error'),
    );

  await admin.query('SELECT pg_terminate_backend($1, $2)', [
    await pidKnown,
    SESSION_END_WAIT_MS,
  ]);
  const inFlightWork = await work;
  const next = await sql<{ one: number }>`SELECT 1 AS one`.execute(database);
  await admin.end();
  await pool.end();
  process.stdout.write(
    `${JSON.stringify({ inFlightWork, nextAnswer: next.rows[0]?.one })}\n`,
  );
}

void main(process.argv[2]);
