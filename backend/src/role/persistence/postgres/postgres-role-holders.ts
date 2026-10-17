import type { Transaction } from 'kysely';
import type { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  anyText,
  anyUuid,
} from '../../../session/persistence/postgres/postgres-bind-parameters';
import type {
  HolderMove,
  HolderSessionBump,
  MovedHolders,
} from '../../stores/role-records';

export async function changeRoleHolderSessions(
  work: Transaction<PostgresTables>,
  change: HolderMove | HolderSessionBump,
): Promise<MovedHolders> {
  if (
    change.fromSlugs.length === 0 ||
    ('holderIds' in change && change.holderIds?.length === 0)
  ) {
    return { holderIds: [], moved: 0 };
  }
  let holders = work
    .selectFrom('users')
    .select('id')
    .where('role', '=', anyText([...new Set(change.fromSlugs)]));
  if ('audience' in change && change.audience !== undefined) {
    holders = holders.where('audience', '=', change.audience);
  }
  if ('excludingAudience' in change && change.excludingAudience !== undefined) {
    holders = holders.where(
      'audience',
      'is distinct from',
      change.excludingAudience,
    );
  }
  if ('holderIds' in change && change.holderIds) {
    holders = holders.where('id', '=', anyUuid(change.holderIds.map(toUuid)));
  }
  const taken = await holders.orderBy('id').forNoKeyUpdate().noWait().execute();
  if (taken.length === 0) return { holderIds: [], moved: 0 };
  const changed = await work
    .updateTable('users')
    .set((column) => ({
      ...('toSlug' in change ? { role: change.toSlug } : {}),
      session_version: column('session_version', '+', 1),
    }))
    .where('id', '=', anyUuid(taken.map((holder) => holder.id)))
    .returning('id')
    .execute();
  return { holderIds: changed.map((row) => row.id), moved: changed.length };
}
