import { sql } from 'kysely';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  AdminRosterStore,
  AdminSignInRule,
} from '../../stores/admin-roster.store';

const ADMIN_ROSTER_LOCK = 4815162350;
const ADMIN_ROLE = 'admin';

export class PostgresAdminRosterStore extends AdminRosterStore {
  async lock(unitOfWork: UnitOfWork): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(${ADMIN_ROSTER_LOCK}::bigint)`.execute(
      postgresTransactionOf(unitOfWork),
    );
  }

  async countAdminsWhoCanSignIn(
    unitOfWork: UnitOfWork,
    rule: AdminSignInRule,
  ): Promise<number> {
    let query = postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('role', '=', ADMIN_ROLE)
      .where('is_deleted', '=', false);
    if (rule.excluding.length > 0) {
      query = query.where('id', 'not in', [...rule.excluding]);
    }
    // feature:passkeys:start
    if (rule.passkeyRelyingParty) {
      const { rpId, includesUnmarked } = rule.passkeyRelyingParty;
      const result = await query
        .where(
          sql<boolean>`EXISTS (
          SELECT 1 FROM passkeys
           WHERE passkeys.user_id = users.id
             AND (passkeys.rp_id = ${rpId}
               OR (${includesUnmarked} AND passkeys.rp_id IS NULL))
        )`,
        )
        .executeTakeFirstOrThrow();
      return Number(result.count);
    }
    // feature:passkeys:end
    const result = await query
      .where('is_verified', '=', true)
      .where('pending_email', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  async hasActiveAdministrator(unitOfWork: UnitOfWork): Promise<boolean> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select('id')
      .where('role', '=', ADMIN_ROLE)
      .where('is_deleted', '=', false)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }
}
