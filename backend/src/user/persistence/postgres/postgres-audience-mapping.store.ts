import { sql } from 'kysely';
import { RetryableAbortError } from '../../../common/persistence/persistence-errors';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { RoleAudience } from '../../../host/types/host-role.type';
import { AudienceMappingStore } from '../../stores/audience-mapping.store';
import type {
  AudienceMappingAccount,
  AudienceMappingRole,
  AudienceMappingSnapshot,
  AudienceSnapshotOptions,
  MissingAudienceCounts,
} from '../../types/audience-mapping';

export class PostgresAudienceMappingStore extends AudienceMappingStore {
  async missingCounts(work: UnitOfWork): Promise<MissingAudienceCounts> {
    const database = postgresTransactionOf(work);
    const roles = await database
      .selectFrom('roles')
      .select((query) => query.fn.countAll<string>().as('total'))
      .where('audience', 'is', null)
      .executeTakeFirstOrThrow();
    const accounts = await database
      .selectFrom('users')
      .select((query) => query.fn.countAll<string>().as('total'))
      .where('audience', 'is', null)
      .executeTakeFirstOrThrow();
    return { roles: Number(roles.total), accounts: Number(accounts.total) };
  }

  async snapshot(
    work: UnitOfWork,
    options: AudienceSnapshotOptions = {},
  ): Promise<AudienceMappingSnapshot> {
    const database = postgresTransactionOf(work);
    let rolesQuery = database
      .selectFrom('roles')
      .select(['id', 'slug', 'audience', 'permissions'])
      .orderBy('id');
    let accountsQuery = database
      .selectFrom('users')
      .select(['id', 'role', 'audience', 'permissions'])
      .orderBy('id');
    if (options.lock) {
      rolesQuery = rolesQuery.forUpdate();
      accountsQuery = accountsQuery.forUpdate();
    }
    const roles = await rolesQuery.execute();
    const accounts = await accountsQuery.execute();
    return {
      roles: roles.map(({ audience, ...role }) => ({
        ...role,
        ...(audience === null ? {} : { audience }),
      })),
      accounts: accounts.map(({ audience, ...account }) => ({
        ...account,
        ...(audience === null ? {} : { audience }),
      })),
    };
  }

  async mapRole(
    work: UnitOfWork,
    role: AudienceMappingRole,
    audience: RoleAudience,
  ): Promise<void> {
    // The general role update type intentionally keeps audience immutable.
    const changed = await sql<{ id: string }>`
      UPDATE roles SET audience = ${audience}, updated_at = now()
       WHERE id = ${role.id}::uuid AND slug = ${role.slug} AND audience IS NULL
       RETURNING id`.execute(postgresTransactionOf(work));
    if (changed.rows.length !== 1) throw new RetryableAbortError();
  }

  async mapAccount(
    work: UnitOfWork,
    account: AudienceMappingAccount,
    audience: RoleAudience,
  ): Promise<void> {
    const changed = await postgresTransactionOf(work)
      .updateTable('users')
      .set({ audience, updated_at: sql<Date>`now()` })
      .where('id', '=', account.id)
      .where('role', '=', account.role)
      .where('audience', 'is', null)
      .returning('id')
      .execute();
    if (changed.length !== 1) throw new RetryableAbortError();
  }
}
