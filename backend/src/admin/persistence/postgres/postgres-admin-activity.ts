import type { Kysely } from 'kysely';
import type { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { anyUuid } from '../../../session/persistence/postgres/postgres-bind-parameters';

export async function postgresAdminActivity(
  database: Kysely<PostgresTables>,
  ids: readonly string[],
): Promise<Map<string, Date | null>> {
  if (ids.length === 0) return new Map();
  const rows = await database
    .selectFrom('users')
    .where('users.id', '=', anyUuid([...ids]))
    .select((user) => [
      'users.id',
      user
        .selectFrom('sessions')
        .select('last_used_at')
        .whereRef('sessions.user_id', '=', 'users.id')
        .orderBy('last_used_at', 'desc')
        .limit(1)
        .as('last_active_at'),
    ])
    .execute();
  return new Map(rows.map((row) => [row.id, row.last_active_at ?? null]));
}
