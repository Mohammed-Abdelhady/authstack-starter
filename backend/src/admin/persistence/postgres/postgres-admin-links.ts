import type { Kysely } from 'kysely';
import type { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import type { LinkedAccountRecord } from '../../../user/stores/stored-account';
import { anyUuid } from '../../../session/persistence/postgres/postgres-bind-parameters';

/**
 * The links of a page of accounts in one statement, each account's in the
 * order they were made.
 */
export async function linkedAccountsByUser(
  database: Kysely<PostgresTables>,
  userIds: string[],
): Promise<Map<string, LinkedAccountRecord[]>> {
  const links = new Map<string, LinkedAccountRecord[]>();
  if (userIds.length === 0) return links;
  const rows = await database
    .selectFrom('user_linked_accounts')
    .select(['user_id', 'provider', 'provider_id', 'linked_at'])
    .where('user_id', '=', anyUuid(userIds))
    .orderBy('id')
    .execute();
  for (const row of rows) {
    const ofUser = links.get(row.user_id) ?? [];
    ofUser.push({
      provider: row.provider,
      providerId: row.provider_id,
      linkedAt: row.linked_at,
    });
    links.set(row.user_id, ofUser);
  }
  return links;
}
