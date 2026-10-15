import type { PostgresDatabase } from '../../src/common/persistence/postgres/postgres-connection';

const UNREADABLE_EVENTS = 'activity_reader_failure';

export async function makeActivityUnreadable(
  database: PostgresDatabase,
): Promise<() => Promise<void>> {
  await database.schema
    .alterTable('security_events')
    .renameTo(UNREADABLE_EVENTS)
    .execute();
  return () =>
    database.schema
      .alterTable(UNREADABLE_EVENTS)
      .renameTo('security_events')
      .execute();
}
